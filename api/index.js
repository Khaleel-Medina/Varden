import { put, del, list } from "@vercel/blob";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).send();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  try {
    // Blob storage routes
    if (req.method === "POST" && req.url.includes("/upload")) {
      return handleUpload(req, res);
    }

    if (req.method === "DELETE" && req.url.includes("/blob/")) {
      const blobUrl = req.url.split("/blob/")[1];
      await del(blobUrl);
      return res.json({ success: true });
    }

    // Character CRUD
    if (req.url.includes("/characters")) {
      if (req.method === "GET") {
        return res.json({ characters: [] });
      }
      if (req.method === "POST") {
        const body = await readBody(req);
        return res.json({ success: true, character: body });
      }
    }

    return res.status(404).json({ error: "Not found" });
  } catch (err) {
    console.error("API error:", err);
    return res.status(500).json({ error: err.message });
  }
}

async function handleUpload(req, res) {
  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const filename = searchParams.get("filename") || "upload.jpg";

  try {
    const blob = await put(filename, req.body, {
      access: "public",
      contentType: req.headers["content-type"] || "image/jpeg",
    });

    return res.json({ url: blob.url, token: blob.token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}
