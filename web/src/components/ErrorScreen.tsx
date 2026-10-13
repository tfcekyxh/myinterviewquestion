import type { ReactNode } from 'react'

interface Props {
  message: string
  /** 重试 / 退路按钮。没有退路的页面（比如整个页面都读不出来）也至少要显示错误，不能白屏 */
  action?: { label: string; onClick: () => void } | null
  children?: ReactNode
}

/**
 * 整页失败态（P5）。
 *
 * 项目里到处都在重复「错误条 + 一个按钮」，抽出来是为了保证一件事：
 * **任何接口失败都必须看得见**（role=alert），且**必须给得出下一步**，
 * 不能出现只剩一片空白、用户不知道发生了什么的情况。
 */
export default function ErrorScreen({ message, action, children }: Props) {
  return (
    <div className="screen">
      <div style={{ flex: 1 }} />
      <div className="inline-error" role="alert">
        {message}
      </div>
      {action && (
        <button type="button" className="btn-primary" style={{ marginTop: 16 }} onClick={action.onClick}>
          {action.label}
        </button>
      )}
      {children}
      <div style={{ flex: 1 }} />
    </div>
  )
}
