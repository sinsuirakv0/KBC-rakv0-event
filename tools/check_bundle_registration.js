import fs from 'fs';
import crypto from 'crypto';

function readEnvSecret(envPath){
  try{
    const txt = fs.readFileSync(envPath, 'utf8');
    const m = txt.match(/^\s*APP_BUNDLE_SECRET\s*=\s*(.+)\s*$/m);
    if(m) return m[1].trim();
  }catch(e){}
  return process.env.APP_BUNDLE_SECRET || null;
}

function decryptEnc(encText, secret){
  const [ivHex, encB64] = encText.split(':');
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]);
  return plain.toString('utf8');
}

try{
  const appEncPath = '../KBC-rakv0-event-app/app.enc';
  if(!fs.existsSync(appEncPath)){
    console.error('ERR: app.enc not found at', appEncPath);
    process.exit(2);
  }
  const enc = fs.readFileSync(appEncPath, 'utf8').trim();
  const secret = readEnvSecret('../KBC-rakv0-event-app/.env.local');
  if(!secret){
    console.error('ERR: APP_BUNDLE_SECRET not found in .env.local or env');
    process.exit(2);
  }

  const plain = decryptEnc(enc, secret);

  const foundKBC = plain.includes('KBCPublic') || plain.includes('window.KBCPublic');
  const foundRegisterCall = plain.includes('KBCPublic.register') || plain.includes('register(');
  const foundRenderAll = plain.includes('renderAll') || plain.includes('window.renderAll');

  console.log(JSON.stringify({ foundKBC, foundRegisterCall, foundRenderAll }));
}catch(e){
  console.error('ERR:', e && e.message ? e.message : e);
  process.exit(3);
}
