import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Login from './Login'
import { login as loginApi } from '../lib/api'

vi.mock('../lib/api', () => ({ login: vi.fn() }))

const mockedLogin = vi.mocked(loginApi)

describe('Login', () => {
  beforeEach(() => {
    mockedLogin.mockReset()
  })

  it('渲染产品名与账号、密码两个输入框', () => {
    render(<Login onSuccess={vi.fn()} />)
    expect(screen.getByText('面试题背诵')).toBeInTheDocument()
    expect(screen.getByLabelText('账号')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
  })

  it('没填就提交：提示且不打接口', async () => {
    render(<Login onSuccess={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请填写账号和密码')
    expect(mockedLogin).not.toHaveBeenCalled()
  })

  it('密码错误：显示服务端返回的错误，不弹窗', async () => {
    mockedLogin.mockRejectedValue(new Error('账号或密码不正确'))
    render(<Login onSuccess={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('账号'), 'admin')
    await userEvent.type(screen.getByLabelText('密码'), 'bad')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('账号或密码不正确')
  })

  it('登录成功：回调 onSuccess', async () => {
    mockedLogin.mockResolvedValue({ userId: 1, account: 'admin' })
    const onSuccess = vi.fn()
    render(<Login onSuccess={onSuccess} />)
    await userEvent.type(screen.getByLabelText('账号'), 'admin')
    await userEvent.type(screen.getByLabelText('密码'), 'pw')
    await userEvent.click(screen.getByRole('button', { name: '登录' }))
    expect(mockedLogin).toHaveBeenCalledWith('admin', 'pw')
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  })

  it('密码默认隐藏，点「显示」后变明文', async () => {
    render(<Login onSuccess={vi.fn()} />)
    const input = screen.getByLabelText('密码')
    expect(input).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(input).toHaveAttribute('type', 'text')
  })
})
