export async function pinJsonToPinata(args: {
  jwt: string;
  name: string;
  body: unknown;
}): Promise<string> {
  const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataMetadata: { name: args.name },
      pinataContent: args.body,
    }),
  });
  if (!res.ok)
    throw new Error(`Pinata pin failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { IpfsHash?: string };
  if (!data.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return data.IpfsHash;
}
