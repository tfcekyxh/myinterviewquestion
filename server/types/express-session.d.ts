// express-session 的 SessionData 扩展：项目自己在 session 上挂了两个字段。
// 声明合并进 @types/express-session 的接口，全局（含 req.session）生效。
//
// ⚠️ 文件必须是个「模块」（有顶层 import）才能做模块增强；
//    纯全局脚本里的 declare module 不会与 node_modules 里的类型合并。
import 'express-session'

declare module 'express-session' {
  interface SessionData {
    userId?: number
    account?: string
  }
}
