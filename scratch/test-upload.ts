import { getAuthedClient } from "../lib/auth.ts";
import { pdsUrl } from "../lib/config.ts";

try {
  const { client, token, did } = await getAuthedClient();
  const fileBytes = new Uint8Array([1, 2, 3, 4]); // dummy bytes
  
  const res = await fetch(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      Authorization: `Bearer ${token}`,
    },
    body: fileBytes,
  });
  
  console.log("status:", res.status);
  if (res.ok) {
    const data = await res.json();
    console.log("blob:", JSON.stringify(data.blob));
  } else {
    console.error(await res.text());
  }
} catch (e) {
  console.error(e);
}
