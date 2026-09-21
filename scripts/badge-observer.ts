import * as anchor from "@coral-xyz/anchor";
import { BorshCoder, EventParser, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Fundraiser } from "../target/types/fundraiser";
import { buildBadgeJson } from "./build-badge-json";
import { loadBadgeConfig, metadataUri } from "./load-config";
import { pinJsonToPinata } from "./pinata";

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function loadKeypair(keypairPath: string): anchor.web3.Keypair {
  const raw = fs.readFileSync(expandHome(keypairPath), "utf8");
  return anchor.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
}

const FIXTURE_URI = "https://example.com/badge.json";

export async function airdropOne(args: {
  program: Program<Fundraiser>;
  payer: anchor.web3.Keypair;
  fundraiser: anchor.web3.PublicKey;
  contributor: anchor.web3.PublicKey;
  uri: string;
}): Promise<string> {
  const badgeMint = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("badge"),
      args.fundraiser.toBuffer(),
      args.contributor.toBuffer(),
    ],
    args.program.programId,
  )[0];
  const contributorAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("contributor"),
      args.fundraiser.toBuffer(),
      args.contributor.toBuffer(),
    ],
    args.program.programId,
  )[0];
  const badgeAta = getAssociatedTokenAddressSync(
    badgeMint,
    args.contributor,
    false,
    TOKEN_2022_PROGRAM_ID,
  );

  return args.program.methods
    .airdropBadge(args.uri)
    .accountsPartial({
      payer: args.payer.publicKey,
      contributor: args.contributor,
      fundraiser: args.fundraiser,
      contributorAccount,
      badgeMint,
      badgeAta,
      token2022Program: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([args.payer])
    .rpc();
}

async function handleClaimed(
  program: Program<Fundraiser>,
  payer: anchor.web3.Keypair,
  fundraiser: anchor.web3.PublicKey,
  contributors: Set<string>,
  config: ReturnType<typeof loadBadgeConfig>,
) {
  const campaign = await program.account.fundraiser.fetch(fundraiser);

  for (const contrib of contributors) {
    const contributor = new anchor.web3.PublicKey(contrib);
    const [pda] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("contributor"),
        fundraiser.toBuffer(),
        contributor.toBuffer(),
      ],
      program.programId,
    );
    const account = await program.account.contributor.fetchNullable(pda);
    if (!account || account.badgeMinted) continue;

    const [badgeMint] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("badge"), fundraiser.toBuffer(), contributor.toBuffer()],
      program.programId,
    );

    const json = buildBadgeJson({
      name: config.badgeName,
      symbol: config.badgeSymbol,
      image: config.badgeImageUri,
      contributor: contributor.toBase58(),
      beneficiary: campaign.maker.toBase58(),
      amount: account.amount.toString(),
      position: account.position,
      collaborations: account.collaborations.map((c) => ({
        timestamp: c.timestamp.toNumber(),
        amount: c.amount.toString(),
      })),
      mint: badgeMint.toBase58(),
    });

    let uri = FIXTURE_URI;
    if (config.pinataJwt) {
      const cid = await pinJsonToPinata({
        jwt: config.pinataJwt,
        name: `badge-${contributor.toBase58()}`,
        body: json,
      });
      uri = metadataUri(cid, config);
    }

    await airdropOne({ program, payer, fundraiser, contributor, uri });
    console.log("airdropped", contributor.toBase58(), uri);
  }
}

async function main() {
  const config = loadBadgeConfig(process.env, true);
  const payer = loadKeypair(config.airdropPayerKeypair);
  const connection = new anchor.web3.Connection(config.rpcUrl, {
    wsEndpoint: config.wsUrl,
    commitment: "confirmed",
  });
  const provider = new anchor.AnchorProvider(
    connection,
    new anchor.Wallet(payer),
    {
      commitment: "confirmed",
    },
  );
  const idl = require("../target/idl/fundraiser.json");
  const program = new anchor.Program<Fundraiser>(idl, provider);
  const parser = new EventParser(
    program.programId,
    new BorshCoder(program.idl),
  );

  const index = new Map<string, Set<string>>();

  console.log(
    "listening",
    program.programId.toBase58(),
    "minter",
    payer.publicKey.toBase58(),
  );

  connection.onLogs(program.programId, async (log) => {
    try {
      for (const event of parser.parseLogs(log.logs)) {
        if (event.name === "contributionRecorded") {
          const fundraiser = (
            event.data.fundraiser as anchor.web3.PublicKey
          ).toBase58();
          const contributor = (
            event.data.contributor as anchor.web3.PublicKey
          ).toBase58();
          const set = index.get(fundraiser) ?? new Set<string>();
          set.add(contributor);
          index.set(fundraiser, set);
        }
        if (event.name === "campaignClaimed") {
          const fundraiser = event.data.fundraiser as anchor.web3.PublicKey;
          const known = index.get(fundraiser.toBase58()) ?? new Set<string>();
          await handleClaimed(program, payer, fundraiser, known, config);
        }
      }
    } catch (err) {
      console.error("observer tick failed", err);
    }
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
