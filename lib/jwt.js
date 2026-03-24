import crypto from "crypto";

async function getInquiryCode() {
  const res  = await fetch("https://nyanko-backups.ponosgames.com/?action=createAccount&referenceId=");
  const json = await res.json();
  return json.accountId;
}

function generateSignature(inquiryCode, dataString) {
  const randomData = crypto.randomBytes(32).toString("hex");
  const key        = inquiryCode + randomData;
  const hmac       = crypto.createHmac("sha256", key);
  hmac.update(dataString);
  return randomData + hmac.digest("hex");
}

async function getPassword(inquiryCode) {
  const data = {
    accountCode:      inquiryCode,
    accountCreatedAt: Math.floor(Date.now() / 1000).toString(),
    nonce:            crypto.randomBytes(16).toString("hex"),
  };
  const dataString = JSON.stringify(data);

  const res  = await fetch("https://nyanko-auth.ponosgames.com/v1/users", {
    method:  "POST",
    headers: {
      "content-type":               "application/json",
      "nyanko-signature":           generateSignature(inquiryCode, dataString),
      "nyanko-timestamp":           Math.floor(Date.now() / 1000).toString(),
      "nyanko-signature-version":   "1",
      "nyanko-signature-algorithm": "HMACSHA256",
      "user-agent":                 "Dalvik/2.1.0 (Linux; Android 9; SM-G955F Build/N2G48B)",
    },
    body: dataString,
  });

  const json = await res.json();
  return json.payload.password;
}

async function getToken(inquiryCode, password) {
  const data = {
    clientInfo: {
      client: { countryCode: "ja", version: "999999" },
      device: { model: "ONEPLUS A3010" },
      os:     { type: "android", version: "7.1.1" },
    },
    password,
    accountCode: inquiryCode,
    nonce:       crypto.randomBytes(16).toString("hex"),
  };
  const dataString = JSON.stringify(data);

  const res  = await fetch("https://nyanko-auth.ponosgames.com/v1/tokens", {
    method:  "POST",
    headers: {
      "content-type":               "application/json",
      "nyanko-signature":           generateSignature(inquiryCode, dataString),
      "nyanko-timestamp":           Math.floor(Date.now() / 1000).toString(),
      "nyanko-signature-version":   "1",
      "nyanko-signature-algorithm": "HMACSHA256",
      "user-agent":                 "Dalvik/2.1.0 (Linux; Android 9; SM-G955F Build/N2G48B)",
    },
    body: dataString,
  });

  const json = await res.json();
  return json.payload.token;
}

export async function getJWT() {
  const inquiry  = await getInquiryCode();
  const password = await getPassword(inquiry);
  return await getToken(inquiry, password);
}
