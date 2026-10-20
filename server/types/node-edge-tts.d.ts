// node-edge-tts 没有随包发布类型定义，这里按本项目实际用到的 API 声明。
// 只覆盖 tts.ts 用到的构造选项与 ttsPromise。
declare module 'node-edge-tts' {
  export class EdgeTTS {
    constructor(options?: {
      voice?: string
      outputFormat?: string
      timeout?: number
      lang?: string
    })
    /** 把 text 朗读成音频文件，写到 dest 路径 */
    ttsPromise(text: string, dest: string): Promise<void>
  }
}
