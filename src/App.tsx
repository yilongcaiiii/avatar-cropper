import { useState, useRef, useCallback } from 'react'

// ===================== 类型定义 =====================
type AppState = 'idle' | 'processing' | 'done' | 'error'

interface ProcessResult {
  blob: Blob
  dataUrl: string
  sizeKB: number
}

// ===================== 常量 =====================
const OUTPUT_SIZE = 300
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_OUTPUT_KB = 200
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']

// ===================== 核心处理逻辑 =====================

/**
 * 将图片文件裁剪为正方形并压缩
 * 算法：以图片中心为基准，取最大正方形区域，输出 300x300，压缩至 200KB 以内
 */
function processImage(file: File): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        // 计算居中裁剪参数
        const sourceSize = Math.min(img.width, img.height)
        const sourceX = (img.width - sourceSize) / 2
        const sourceY = (img.height - sourceSize) / 2

        // 创建 Canvas 绘制裁剪后的图片
        const canvas = document.createElement('canvas')
        canvas.width = OUTPUT_SIZE
        canvas.height = OUTPUT_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持 Canvas'))
          return
        }

        ctx.drawImage(
          img,
          sourceX, sourceY, sourceSize, sourceSize,  // 源区域（居中取正方形）
          0, 0, OUTPUT_SIZE, OUTPUT_SIZE              // 目标区域（300x300）
        )

        // 循环压缩直到 ≤200KB 或 quality < 0.1
        let quality = 0.9
        const tryCompress = (): void => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('图片导出失败'))
                return
              }

              const sizeKB = blob.size / 1024

              if (sizeKB <= MAX_OUTPUT_KB || quality < 0.1) {
                resolve({
                  blob,
                  dataUrl: URL.createObjectURL(blob),
                  sizeKB: Math.round(sizeKB * 100) / 100,
                })
              } else {
                quality -= 0.05
                tryCompress()
              }
            },
            'image/jpeg',
            quality
          )
        }

        tryCompress()
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = URL.createObjectURL(file)
  })
}

/**
 * 验证上传的文件
 */
function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return '请上传图片文件'
  }
  if (file.size > MAX_FILE_SIZE) {
    return '图片文件过大，请上传小于 10MB 的图片'
  }
  return null
}

// ===================== 组件 =====================

function App() {
  const [state, setState] = useState<AppState>('idle')
  const [error, setError] = useState<string>('')
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [originalPreview, setOriginalPreview] = useState<string>('')
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 处理文件选择
  const handleFile = useCallback(async (file: File) => {
    // 校验
    const validationError = validateFile(file)
    if (validationError) {
      setState('error')
      setError(validationError)
      return
    }

    // 检查浏览器支持
    if (!document.createElement('canvas').getContext) {
      setState('error')
      setError('浏览器不支持，请更换浏览器')
      return
    }

    setOriginalFile(file)
    setOriginalPreview(URL.createObjectURL(file))
    setResult(null)
    setState('processing')
    setError('')

    try {
      const processResult = await processImage(file)
      setResult(processResult)
      setState('done')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : '处理失败，请重试')
    }
  }, [])

  // 文件 input 变化
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // 重置 input 以便重复选择同一文件
    e.target.value = ''
  }

  // 拖拽处理
  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // 下载处理后的图片
  const downloadImage = () => {
    if (!result) return
    const link = document.createElement('a')
    link.href = result.dataUrl
    link.download = `cropped-${Date.now()}.jpg`
    link.click()
  }

  // 重新上传
  const resetUpload = () => {
    if (originalPreview) URL.revokeObjectURL(originalPreview)
    if (result) URL.revokeObjectURL(result.dataUrl)
    setState('idle')
    setError('')
    setOriginalFile(null)
    setOriginalPreview('')
    setResult(null)
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] text-gray-800">
      {/* ========== 头部 ========== */}
      <header className="text-center pt-10 pb-6 px-4">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">
          🖼️ 智能方形头像裁剪器
        </h1>
        <p className="mt-3 text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
          上传任意图片，自动智能裁剪为正方形并压缩，一键生成社交媒体标准头像
        </p>
      </header>

      {/* ========== 主体内容 - 左右两栏布局 ========== */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-[61.8%_38.2%] gap-6 items-start">

          {/* ======== 左栏 ======== */}
          <div className="space-y-5">
            {/* 上传区域 / 原图预览 */}
            {(state === 'idle') && (
              <div
                className={`border-2 border-dashed rounded-2xl p-8 md:p-12 text-center cursor-pointer transition-all duration-200 bg-white
                  ${isDragOver
                    ? 'border-blue-500 bg-blue-50 scale-[1.01]'
                    : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                  }`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="hidden"
                />
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-700">点击或拖拽图片到此处</p>
                <p className="mt-2 text-sm text-gray-400">支持 JPG、PNG、WebP、GIF · 最大 10MB</p>
              </div>
            )}

            {(state === 'processing' || state === 'done') && originalPreview && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">原始图片</h3>
                  <button
                    onClick={resetUpload}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                  >
                    ↻ 重新上传
                  </button>
                </div>
                <div className="relative rounded-xl overflow-hidden bg-black/5 flex items-center justify-center min-h-[280px] max-h-[400px]">
                  <img
                    src={originalPreview}
                    alt="原图预览"
                    className="max-w-full max-h-[380px] object-contain"
                  />
                  {/* 裁剪框示意 */}
                  {state === 'done' && (
                    <div className="absolute inset-0 pointer-events-none">
                      <CropOverlay imgSrc={originalPreview} />
                    </div>
                  )}
                </div>
                {originalFile && (
                  <p className="mt-2 text-xs text-gray-400 text-right">
                    原始大小：{(originalFile.size / 1024).toFixed(1)} KB
                  </p>
                )}
              </div>
            )}

            {/* 功能说明卡片 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                ✨ 功能特点
              </h3>
              <ul className="space-y-3">
                {[
                  { icon: '🎯', text: '自动识别图片中心区域，智能裁剪成正方形' },
                  { icon: '📐', text: '输出尺寸固定为 300×300 像素' },
                  { icon: '🗜️', text: '自动压缩至 200KB 以内，保持画质清晰' },
                  { icon: '🔒', text: '所有处理在浏览器本地完成，保护隐私安全' },
                ].map((item) => (
                  <li key={item.text} className="flex items-start gap-3 text-sm text-gray-600">
                    <span className="mt-0.5">{item.icon}</span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* ======== 右栏 ======== */}
          <div className="lg:sticky lg:top-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 min-h-[360px] flex flex-col">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
                裁剪结果
              </h3>

              {state === 'idle' && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                  <svg className="w-24 h-24 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">上传图片后在此预览</p>
                </div>
              )}

              {state === 'processing' && (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <Spinner />
                  <p className="mt-4 text-sm text-gray-500 font-medium">正在处理...</p>
                </div>
              )}

              {state === 'done' && result && (
                <div className="flex-1 flex flex-col items-center">
                  <div className="w-52 h-52 rounded-2xl overflow-hidden shadow-md ring-4 ring-gray-100">
                    <img
                      src={result.dataUrl}
                      alt="裁剪结果"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* 结果信息 */}
                  <div className="mt-5 w-full space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-gray-50 rounded-xl py-3 px-4 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">尺寸</p>
                        <p className="text-sm font-bold text-gray-800">300 × 300</p>
                      </div>
                      <div className="bg-gray-50 rounded-xl py-3 px-4 text-center">
                        <p className="text-xs text-gray-400 mb-0.5">体积</p>
                        <p className={`text-sm font-bold ${result.sizeKB <= 150 ? 'text-green-600' : result.sizeKB <= 190 ? 'text-orange-500' : 'text-red-500'}`}>
                          {result.sizeKB.toFixed(1)} KB
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={downloadImage}
                      className="w-full py-3 px-4 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors cursor-pointer text-sm flex items-center justify-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      下载头像
                    </button>
                  </div>
                </div>
              )}

              {state === 'error' && (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-3">
                    <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </div>
                  <p className="text-red-500 text-sm font-medium text-center px-4">{error}</p>
                  <button
                    onClick={() => { setState('idle'); setError(''); }}
                    className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline cursor-pointer"
                  >
                    重新尝试
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ========== 页脚 ========== */}
      <footer className="py-6 text-center text-xs text-gray-400 border-t border-gray-200 bg-white">
        所有图片处理均在浏览器本地完成，不会上传到服务器
      </footer>
    </div>
  )
}

// ===================== 子组件 =====================

/** 加载动画 Spinner */
function Spinner() {
  return (
    <div className="w-12 h-12 border-3 border-gray-200 border-t-gray-900 rounded-full animate-spin" style={{ borderWidth: '3px' }} />
  )
}

/** 裁剪框叠加层 - 在原图上显示即将被裁剪的中心区域 */
function CropOverlay({ imgSrc }: { imgSrc: string }) {
  const [cropRect, setCropRect] = useState<{ x: number; y: number; size: number; imgW: number; imgH: number } | null>(null)

  useState(() => {
    const img = new Image()
    img.onload = () => {
      const containerW = img.width
      const containerH = img.height
      const sourceSize = Math.min(containerW, containerH)
      setCropRect({
        x: (containerW - sourceSize) / 2,
        y: (containerH - sourceSize) / 2,
        size: sourceSize,
        imgW: containerW,
        imgH: containerH,
      })
    }
    img.src = imgSrc
  })

  if (!cropRect) return null

  // 计算在容器中的百分比位置
  const leftPct = (cropRect.x / cropRect.imgW) * 100
  const topPct = (cropRect.y / cropRect.imgH) * 100
  const sizePct = (cropRect.size / cropRect.imgW) * 100

  return (
    <div
      className="absolute border-2 border-white/80 shadow-[inset_0_0_0_9999px_rgba(0,0,0,0.35)]"
      style={{
        left: `${leftPct}%`,
        top: `${topPct}%`,
        width: `${sizePct}%`,
        height: `${(cropRect.size / cropRect.imgH) * 100}%`,
      }}
    />
  )
}

export default App
