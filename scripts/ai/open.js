/* 암호화된 댓글 AI 결과 열기 (사용자 컴퓨터에서만) — scripts/.ai-key/private.pem 필요(커밋 금지)
   사용: node scripts/ai/open.js <파일.enc.json> [출력.json] */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

function open(file, keyFile = path.join(__dirname, '..', '.ai-key', 'private.pem')) {
  const box = JSON.parse(fs.readFileSync(file, 'utf8'));
  const priv = fs.readFileSync(keyFile, 'utf8');
  const key = crypto.privateDecrypt({ key: priv, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(box.key, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  const raw = Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]);
  return JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
}

if (require.main === module) {
  const [, , inFile, outFile] = process.argv;
  const obj = open(inFile);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(obj, null, 1));
  else console.log(JSON.stringify(obj).slice(0, 2000));
}
module.exports = { open };
