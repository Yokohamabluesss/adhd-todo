import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = 'http://127.0.0.1:4174/';
const vite = 'node_modules/vite/bin/vite.js';
process.chdir(root);
async function ready() {
  let response;
  try { response = await fetch(url,{signal:AbortSignal.timeout(1200)}); } catch { return false; }
  if (response.ok && (await response.text()).includes('<title>ADHD Todo · Task board')) return true;
  throw new Error('Port 4174 is in use by a different program. Close it and try again.');
}
async function launch() {
  if (!await ready()) {
    if (!existsSync(vite)) throw new Error('Run npm ci in the ADHD Todo folder first.');
    if (!existsSync('dist/index.html')) {
      const built = spawnSync(process.execPath,[vite,'build'],{stdio:'inherit',windowsHide:true});
      if (built.status !== 0) throw new Error('Build failed. Run npm run build in the project folder for details.');
    }
    const server = spawn(process.execPath,[vite,'preview','--host','127.0.0.1','--port','4174','--strictPort'],
      {cwd:root,detached:true,windowsHide:true,stdio:'ignore'});
    server.unref();
    let started = false;
    for (let i = 0; i < 40 && !started; i++) { await wait(200); started = await ready(); }
    if (!started) throw new Error(`The local board did not start at ${url}`);
  }
  if (process.argv.includes('--check')) return;
  const opener = spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,windowsHide:true,stdio:'ignore'});
  opener.unref();
}
try { await launch(); } catch (err) {
  console.error(err.message);
  if (process.platform === 'win32' && !process.argv.includes('--check')) {
    spawnSync('powershell.exe',['-NoProfile','-Command',
      "Add-Type -AssemblyName PresentationFramework; [void][Windows.MessageBox]::Show($env:ADHD_LAUNCH_ERROR,'ADHD Todo')"],
      {windowsHide:true,env:{...process.env,ADHD_LAUNCH_ERROR:err.message}});
  }
  process.exitCode = 1;
}
