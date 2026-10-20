// 入口。启动硬性要求：读 process.env.PORT，绑 0.0.0.0。
import fs from 'node:fs'
import https from 'node:https'
import { createApp } from './app.ts'
import { ensureUser } from './auth.ts'

// 加载 .env（Node 21.7+ 内置）。文件不存在时静默跳过，账号密码会在下面报错提示
try {
  process.loadEnvFile('.env')
} catch {
  /* 没有 .env 就靠环境变量 */
}

const account = process.env.APP_ACCOUNT
const password = process.env.APP_PASSWORD

try {
  const user = ensureUser(account, password)
  console.log(`账号就绪：${user.account}`)
} catch (e) {
  console.error(`[启动失败] ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}

if (!process.env.SESSION_SECRET) {
  console.warn('[警告] 未设置 SESSION_SECRET，使用开发默认值。上线前务必在 .env 里设置。')
}

const port = Number(process.env.PORT) || 3000
const app = createApp()

app.listen(port, '0.0.0.0', () => {
  console.log(`服务已启动：http://0.0.0.0:${port}（NODE_ENV=${process.env.NODE_ENV ?? 'development'}）`)
})

// ── 真机调试用的 HTTPS ──────────────────────────────────────────────
// Safari 只在安全上下文下给麦克风权限，所以拿手机测录音必须走 HTTPS。
// **只有显式 HTTPS=1 才启用**：否则 e2e（NODE_ENV=test）每次都会去抢 3443 端口，
// 上一轮没退干净就直接 EADDRINUSE 崩掉。
if (process.env.HTTPS === '1') {
  const keyPath = process.env.HTTPS_KEY ?? 'certs/dev.key'
  const certPath = process.env.HTTPS_CERT ?? 'certs/dev.crt'

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    console.error(`[HTTPS 未启动] 找不到证书：${keyPath} / ${certPath}。先跑 node scripts/gen-cert.mjs`)
  } else {
    const httpsPort = Number(process.env.HTTPS_PORT) || 3443
    https
      .createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
      .listen(httpsPort, '0.0.0.0', () => {
        console.log(`HTTPS 已启动：https://0.0.0.0:${httpsPort}（真机调试用，HTTP 端口仍在）`)
        console.log(`手机先访问 http://<本机IP>:${port}/__dev/cert.cer 装证书，再用 https://<本机IP>:${httpsPort}`)
      })
  }
}
