// 入口。启动硬性要求：读 process.env.PORT，绑 0.0.0.0。
import { createApp } from './app.js'
import { ensureUser } from './auth.js'

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
  console.error(`[启动失败] ${e.message}`)
  process.exit(1)
}

if (!process.env.SESSION_SECRET) {
  console.warn('[警告] 未设置 SESSION_SECRET，使用开发默认值。上线前务必在 .env 里设置。')
}

const port = Number(process.env.PORT) || 3000
createApp().listen(port, '0.0.0.0', () => {
  console.log(`服务已启动：http://0.0.0.0:${port}（NODE_ENV=${process.env.NODE_ENV ?? 'development'}）`)
})
