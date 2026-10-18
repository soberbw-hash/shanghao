#!/usr/bin/env bash
set -euo pipefail
umask 077
REVISION="${1:?expected commit required}"
VERSION="${2:?expected version required}"
APP_DIR=/root/shanghao
[[ "$EUID" == 0 && "$REVISION" =~ ^[a-f0-9]{40}$ && "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || exit 2
cd "$APP_DIR"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo 'Tracked server changes require review.'; exit 3; }
check_idle() {
  curl -fsS --max-time 5 http://127.0.0.1:43821/health | node -e '
    let value="";process.stdin.on("data",c=>value+=c);process.stdin.on("end",()=>{
      const h=JSON.parse(value);if(!h.ok||h.connectedPeers!==0||h.phoneMicSessions!==0)process.exit(3);console.log(h.packageVersion);
    });'
}
OLD_VERSION="$(check_idle)"
mkdir -p "$APP_DIR/.codex-backups"
BACKUP="$(mktemp -d "$APP_DIR/.codex-backups/room-isolation-XXXXXXXX")"
chmod 700 "$BACKUP"
git rev-parse HEAD > "$BACKUP/previous-commit.txt"
git archive HEAD package.json packages/shared packages/signaling scripts/start-relay.mjs > "$BACKUP/sources.tar"
cp -a packages/shared/dist "$BACKUP/shared-dist"
cp -a packages/signaling/dist "$BACKUP/signaling-dist"
cp -p package.json "$BACKUP/package.json"
cp -p .env "$BACKUP/environment"
STOPPED=0
rollback() {
  local code=$?
  trap - ERR
  if [[ "$STOPPED" == 1 ]]; then
    cp -a "$BACKUP/shared-dist/." packages/shared/dist/
    cp -a "$BACKUP/signaling-dist/." packages/signaling/dist/
    cp -p "$BACKUP/package.json" package.json
    cp -p "$BACKUP/environment" .env
    SHANGHAO_VERSION="$OLD_VERSION" pm2 restart shanghao-relay --update-env >/dev/null || true
  fi
  echo "Deployment failed; retained backup at $BACKUP. User data was not restored or overwritten."
  exit "$code"
}
trap rollback ERR
git fetch origin main
[[ "$(git rev-parse origin/main)" == "$REVISION" ]]
git merge --ff-only "$REVISION"
[[ "$(node -p 'require("./package.json").version')" == "$VERSION" ]]
corepack pnpm --filter @private-voice/shared build
corepack pnpm --filter @private-voice/signaling build
check_idle >/dev/null
pm2 stop shanghao-relay >/dev/null
STOPPED=1
cp -a data "$BACKUP/data"
node - "$BACKUP" "$VERSION" <<'NODE'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const backup=process.argv[2],version=process.argv[3];
const env=fs.readFileSync('.env','utf8');
for(const line of env.split(/\r?\n/)) {
  const i=line.indexOf('='),key=line.slice(0,i).trim(),value=line.slice(i+1).trim().replace(/^['"]|['"]$/g,'');
  if(['ROOM_DIRECTORY_FILE','CHAT_HISTORY_FILE','DAILY_ROOM_REPORT_FILE'].includes(key)&&
     !path.resolve(value).startsWith('/root/shanghao/data/')) throw Error('Persistent path outside verified backup');
}
const manifest=[];
for(const file of fs.readdirSync(path.join(backup,'data'))) {
  const full=path.join(backup,'data',file);
  if(fs.lstatSync(full).isSymbolicLink())throw Error('Linked data file requires separate backup');
  if(!fs.statSync(full).isFile())continue;
  const bytes=fs.readFileSync(full);if(file.endsWith('.json'))JSON.parse(bytes.toString('utf8'));
  manifest.push({file,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(path.join(backup,'data-checksums.json'),JSON.stringify(manifest),{mode:0o600});
const updated=/^SHANGHAO_VERSION=/m.test(env)?env.replace(/^SHANGHAO_VERSION=.*$/m,'SHANGHAO_VERSION='+version):env+'\nSHANGHAO_VERSION='+version+'\n';
fs.writeFileSync('.env.version-update.tmp',updated,{flag:'wx',mode:0o600});fs.renameSync('.env.version-update.tmp','.env');
NODE
SHANGHAO_VERSION="$VERSION" pm2 restart shanghao-relay --update-env >/dev/null
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 http://127.0.0.1:43821/health > "$BACKUP/health-after.json"; then
    if node - "$BACKUP/health-after.json" "$VERSION" <<'NODE'
const fs=require('node:fs');const h=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!h.ok||h.packageVersion!==process.argv[3]||!h.accountConfigured||!h.turnConfigured)process.exit(1);
console.log(JSON.stringify({ok:h.ok,version:h.packageVersion,build:h.buildNumber,connectedPeers:h.connectedPeers}));
NODE
    then
      STOPPED=0
      pm2 save >/dev/null
      echo "Deployed $REVISION; verified persistent backup: $BACKUP"
      exit 0
    fi
  fi
  sleep 1
done
false
