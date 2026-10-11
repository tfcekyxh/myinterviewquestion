// 生成本机 HTTPS 自签证书，专供「拿真机调试」用。
//
// 为什么必须有它：
//   Safari 只在**安全上下文**（HTTPS 或 localhost）下才允许访问麦克风。
//   手机打开 http://192.168.x.x:3000 会因为不是 HTTPS 而被直接拒绝 ——
//   此时 navigator.mediaDevices 根本是 undefined，代码跑都跑不到，也不会有任何弹窗提示。
//   而手机上的 localhost 是手机自己，所以「用 localhost 绕过」这条路不存在。
//
// 用法：node scripts/gen-cert.mjs
// 产出：
//   certs/dev.key / certs/dev.crt  —— PEM，给 Node 起 HTTPS 用
//   certs/dev.cer                  —— DER，给 iPhone 装描述文件用
//
// 证书里的 SAN 会把本机所有局域网 IPv4 都写进去（手机就是按 IP 访问的，SAN 不匹配会直接被拒）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OUT_DIR = path.resolve('certs')
const KEY = path.join(OUT_DIR, 'dev.key')
const CRT = path.join(OUT_DIR, 'dev.crt')
const CER = path.join(OUT_DIR, 'dev.cer')

function lanIPv4() {
  const out = []
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address)
    }
  }
  return out
}

const ips = lanIPv4()
if (ips.length === 0) {
  console.error('没找到局域网 IPv4，先确认电脑连上了 Wi-Fi 或有线网。')
  process.exit(1)
}

const altNames = ['DNS.1 = localhost', 'IP.1 = 127.0.0.1', ...ips.map((ip, i) => `IP.${i + 2} = ${ip}`)]

// basicConstraints 必须是 CA:TRUE：iOS 侧是把这张证书当**根证书**装进描述文件并手动开启完全信任的
const conf = `[req]
default_bits       = 2048
prompt             = no
default_md         = sha256
distinguished_name = dn
x509_extensions    = v3

[dn]
CN = my-interview-question dev

[v3]
subjectAltName          = @alt
basicConstraints        = critical, CA:TRUE
keyUsage                = critical, digitalSignature, keyEncipherment, keyCertSign
extendedKeyUsage        = serverAuth
subjectKeyIdentifier    = hash
authorityKeyIdentifier  = keyid:always

[alt]
${altNames.join('\n')}
`

fs.mkdirSync(OUT_DIR, { recursive: true })
const confPath = path.join(OUT_DIR, 'openssl.cnf')
fs.writeFileSync(confPath, conf)

console.log('生成中，SAN 覆盖：localhost, 127.0.0.1,', ips.join(', '))

execFileSync(
  'openssl',
  ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', KEY, '-out', CRT, '-days', '365', '-config', confPath],
  { stdio: ['ignore', 'ignore', 'pipe'] },
)
// iPhone 装描述文件吃的是 DER
execFileSync('openssl', ['x509', '-in', CRT, '-outform', 'der', '-out', CER], { stdio: 'ignore' })

// 私钥只给自己读
fs.chmodSync(KEY, 0o600)

const ip = ips[0]
console.log(`
证书已生成：
  ${CRT}
  ${KEY}
  ${CER}   ← 这个装到 iPhone 上

接下来（一次性，约 2 分钟）：
  1. 电脑上启动：npm run dev:https
  2. iPhone 用 **Safari** 打开：http://${ip}:3000/__dev/cert.cer
     会提示「已下载描述文件」→ 去「设置」里点「已下载描述文件」→ 安装
     （安装时会要求输入锁屏密码）
  3. 关键一步：设置 → 通用 → 关于本机 → 证书信任设置 → 把这张证书的开关打开
     不做这一步，Safari 会一直说「无法建立安全连接」
  4. 之后用 Safari 打开：https://${ip}:3443
`)
