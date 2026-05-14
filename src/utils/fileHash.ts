import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function sha256String(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
