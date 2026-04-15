import { useState, useRef, useCallback, useEffect } from 'react'

// ===================== 类型定义 =====================
type AppState = 'idle' | 'editing' | 'processing' | 'done' | 'error'

interface ProcessResult {
  blob: Blob
  dataUrl: string
  sizeKB: number
}

interface CropPosition {
  x: number  // 源图上的裁剪起始 x（像素）
  y: number  // 源图上的裁剪起始 y（像素）
}

// ===================== 常量 =====================
const OUTPUT_SIZE = 300
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_OUTPUT_KB = 200
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']

// ===================== 工具函数 =====================

/** 检测是否为微信内置浏览器 */
function isWeChatBrowser(): boolean {
  const ua = navigator.userAgent.toLowerCase()
  return ua.includes('micromessenger') || ua.includes('wechat')
}

/**
 * 获取高质量 dataURL（用于长按保存）
 */
async function getSaveDataUrl(dataUrl: string): Promise<string> {
  return new Promise<string>((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = OUTPUT_SIZE
      canvas.height = OUTPUT_SIZE
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/jpeg', 0.92))
    }
    img.src = dataUrl
  })
}

// ===================== 核心处理逻辑 =====================

/**
 * 将图片文件按指定位置裁剪为正方形并压缩
 */
function processImageWithCrop(file: File, cropX: number, cropY: number, cropSize: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
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
          cropX, cropY, cropSize, cropSize,
          0, 0, OUTPUT_SIZE, OUTPUT_SIZE
        )

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

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type)) return '请上传图片文件'
  if (file.size > MAX_FILE_SIZE) return '图片文件过大，请上传小于 10MB 的图片'
  return null
}

// ===================== 可拖动裁剪组件 =====================

function DraggableCropArea({
  imgSrc,
  naturalWidth,
  naturalHeight,
  cropPosition,
  onCropChange,
  onCropEnd,
}: {
  imgSrc: string
  naturalWidth: number
  naturalHeight: number
  cropPosition: CropPosition
  onCropChange: (pos: CropPosition) => void
  onCropEnd: (pos: CropPosition) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const dragStart = useRef({ mouseX: 0, mouseY: 0, cropX: 0, cropY: 0 })

  // 计算正方形裁剪区域大小（取较小边）
  const cropSize = Math.min(naturalWidth, naturalHeight)

  // 将源图坐标转换为显示坐标百分比
  const toDisplayPct = (srcVal: number, axis: 'x' | 'y') => {
    const total = axis === 'x' ? naturalWidth : naturalHeight
    return (srcVal / total) * 100
  }

  const leftPct = toDisplayPct(cropPosition.x, 'x')
  const topPct = toDisplayPct(cropPosition.y, 'y')
  const sizePctW = toDisplayPct(cropSize, 'x')
  const sizePctH = toDisplayPct(cropSize, 'y')

  // 鼠标/触摸事件处理
  const handleStart = (clientX: number, clientY: number) => {
    dragging.current = true
    dragStart.current = { mouseX: clientX, mouseY: clientY, cropX: cropPosition.x, cropY: cropPosition.y }
  }

  const handleMove = (clientX: number, clientY: number) => {
    if (!dragging.current || !containerRef.current) return

    const rect = containerRef.current.getBoundingClientRect()
    const dx = clientX - dragStart.current.mouseX
    const dy = clientY - dragStart.current.mouseY

    // 将像素偏移转换为源图坐标偏移
    const scaleX = naturalWidth / rect.width
    const scaleY = naturalHeight / rect.height

    let newX = dragStart.current.cropX + dx * scaleX
    let newY = dragStart.current.cropY + dy * scaleY

    // 边界限制
    newX = Math.max(0, Math.min(newX, naturalWidth - cropSize))
    newY = Math.max(0, Math.min(newY, naturalHeight - cropSize))

    onCropChange({ x: newX, y: newY })
  }

  const handleEnd = () => {
    if (dragging.current) {
      dragging.current = false
      onCropEnd(cropPosition)
    }
  }

  // 鼠标事件
  const onMouseDown = (e: React.MouseEvent) => { e.preventDefault(); handleStart(e.clientX, e.clientY) }
  
  // 触摸事件
  const onTouchStart = (e: React.TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    handleStart(touch.clientX, touch.clientY)
  }

  // 全局鼠标移动/释放
  useEffect(() => {
    const onMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY)
    const onUp = () => handleEnd()
    const onTouchMove = (e: TouchEvent) => {
      if (dragging.current) {
        e.preventDefault()
        const touch = e.touches[0]
        handleMove(touch.clientX, touch.clientY)
      }
    }
    const onTouchEndGlobal = () => handleEnd()

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEndGlobal)
    
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEndGlobal)
    }
  })

  return (
    <div ref={containerRef} className="relative rounded-xl overflow-hidden bg-[#1a1a2e] flex items-center justify-center min-h-[280px] max-h-[400px] select-none">
      <img src={imgSrc} alt="原图预览" className="max-w-full max-h-[380px] object-contain block" draggable={false} />
      
      {/* 可拖动裁剪框 */}
      <div
        className="absolute cursor-move touch-none"
        style={{
          left: `${leftPct}%`,
          top: `${topPct}%`,
          width: `${sizePctW}%`,
          height: `${sizePctH}%`,
          border: '2.5px solid rgba(255,255,255,0.9)',
          boxShadow: 'inset 0 0 0 9999px rgba(0,0,0,0.4), 0 0 20px rgba(0,0,0,0.3)',
        }}
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
      >
        {/* 三分线参考 */}
        <div className="absolute inset-0 pointer-events-none">
          {/* 水平中线 */}
          <div className="absolute left-0 right-0 top-1/3 border-t border-white/30" />
          <div className="absolute left-0 right-0 top-2/3 border-t border-white/30" />
          {/* 垂直中线 */}
          <div className="absolute top-0 bottom-0 left-1/3 border-l border-white/30" />
          <div className="absolute top-0 bottom-0 left-2/3 border-l border-white/30" />
        </div>
        {/* 四角标记 */}
        {[
          'left-[-5px] top-[-5px] border-l-2 border-t-2',
          'right-[-5px] top-[-5px] border-r-2 border-t-2',
          'left-[-5px] bottom-[-5px] border-l-2 border-b-2',
          'right-[-5px] bottom-[-5px] border-r-2 border-b-2',
        ].map((pos, i) => (
          <div key={i} className={`absolute w-[14px] h-[14px] ${pos} border-white/90`} />
        ))}
      </div>
    </div>
  )
}

// ===================== 主组件 =====================

function App() {
  const [state, setState] = useState<AppState>('idle')
  const [error, setError] = useState<string>('')
  const [originalFile, setOriginalFile] = useState<File | null>(null)
  const [originalPreview, setOriginalPreview] = useState<string>('')
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [imgDimensions, setImgDimensions] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const [cropPosition, setCropPosition] = useState<CropPosition>({ x: 0, y: 0 })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const processTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  // 获取默认居中裁剪位置
  const getCenterCrop = useCallback((w: number, h: number): { pos: CropPosition; size: number } => {
    const size = Math.min(w, h)
    return {
      pos: { x: (w - size) / 2, y: (h - size) / 2 },
      size,
    }
  }, [])

  // 执行裁剪处理
  const doProcess = useCallback(async (file: File, cropPos: CropPosition) => {
    const cropSize = Math.min(imgDimensions.w, imgDimensions.h)
    setState('processing')
    try {
      const processResult = await processImageWithCrop(file, cropPos.x, cropPos.y, cropSize)
      setResult(processResult)
      setState('done')
    } catch (err) {
      setState('error')
      setError(err instanceof Error ? err.message : '处理失败，请重试')
    }
  }, [imgDimensions])

  // 防抖处理：拖动结束后触发重新处理
  const debouncedProcess = useCallback((file: File, pos: CropPosition) => {
    if (processTimerRef.current) clearTimeout(processTimerRef.current)
    processTimerRef.current = setTimeout(() => doProcess(file, pos), 150)
  }, [doProcess])

  // 处理文件选择
  const handleFile = useCallback(async (file: File) => {
    const validationError = validateFile(file)
    if (validationError) { setState('error'); setError(validationError); return }
    if (!document.createElement('canvas').getContext) { setState('error'); setError('浏览器不支持，请更换浏览器'); return }

    // 清理旧资源
    if (originalPreview) URL.revokeObjectURL(originalPreview)
    if (result) URL.revokeObjectURL(result.dataUrl)

    const previewUrl = URL.createObjectURL(file)
    setOriginalFile(file)
    setOriginalPreview(previewUrl)
    setResult(null)
    setError('')

    // 获取原始图片尺寸
    const img = new Image()
    img.onload = () => {
      const { pos } = getCenterCrop(img.width, img.height)
      setImgDimensions({ w: img.width, h: img.height })
      setCropPosition(pos)
      setState('editing')

      // 自动进行首次居中裁剪
      doProcess(file, pos)
    }
    img.src = previewUrl
  }, [originalPreview, result, getCenterCrop, doProcess])

  // 裁剪框拖动中
  const onCropChange = (pos: CropPosition) => setCropPosition(pos)

  // 裁剪框拖动结束 → 重新处理
  const onCropEnd = (pos: CropPosition) => {
    if (originalFile && imgDimensions.w > 0) {
      debouncedProcess(originalFile, pos)
    }
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true) }
  const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false) }
  const onDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); const file = e.dataTransfer.files[0]; if (file) handleFile(file) }

  // 下载图片：针对不同环境做适配
  const [showSaveModal, setShowSaveModal] = useState(false)
  const [saveDataUrl, setSaveDataUrl] = useState<string>('')

  const downloadImage = async () => {
    if (!result) return

    // 微信内置浏览器：直接弹出全屏大图（长按保存是唯一可靠方案）
    if (isWeChatBrowser()) {
      const dataUrl = await getSaveDataUrl(result.dataUrl)
      setSaveDataUrl(dataUrl)
      setShowSaveModal(true)
      return
    }

    // 非微信环境：Web Share API → 传统下载 → 长按保存兜底
    try {
      if (navigator.share && navigator.canShare?.({ files: [new File([result.blob], 'cropped.jpg', { type: 'image/jpeg' })] })) {
        await navigator.share({
          files: [new File([result.blob], `cropped-${Date.now()}.jpg`, { type: 'image/jpeg' })],
          title: '头像裁剪结果',
        })
        return
      }
    } catch (err: unknown) {
      const shareErr = err as Error
      if (shareErr?.name === 'AbortError') return
    }

    // 方案2：a 标签下载（桌面浏览器）
    try {
      const link = document.createElement('a')
      link.href = result.dataUrl
      link.download = `cropped-${Date.now()}.jpg`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(() => URL.revokeObjectURL(link.href), 1000)

      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
      if (isMobile) {
        const dataUrl = await getSaveDataUrl(result.dataUrl)
        setSaveDataUrl(dataUrl)
        setShowSaveModal(true)
      }
    } catch {
      const dataUrl = await getSaveDataUrl(result.dataUrl)
      setSaveDataUrl(dataUrl)
      setShowSaveModal(true)
    }
  }

  const resetUpload = () => {
    if (originalPreview) URL.revokeObjectURL(originalPreview)
    if (result) URL.revokeObjectURL(result.dataUrl)
    if (processTimerRef.current) clearTimeout(processTimerRef.current)
    setState('idle'); setError(''); setOriginalFile(null)
    setOriginalPreview(''); setResult(null)
    setImgDimensions({ w: 0, h: 0 })
    setCropPosition({ x: 0, y: 0 })
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#f8f9fa] text-gray-800">
      {/* 头部 */}
      <header className="text-center pt-10 pb-6 px-4">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">🖼️ 智能方形头像裁剪器</h1>
        <p className="mt-3 text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
          上传图片，自由拖动选择裁剪区域，一键生成 300×300 社交媒体标准头像
        </p>
      </header>

      {/* 主体 */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-[61.8%_38.2%] gap-6 items-start">

          {/* 左栏 */}
          <div className="space-y-5">
            {/* 上传区域 */}
            {(state === 'idle') && (
              <div
                className={`border-2 border-dashed rounded-2xl p-8 md:p-12 text-center cursor-pointer transition-all duration-200 bg-white
                  ${isDragOver ? 'border-blue-500 bg-blue-50 scale-[1.01]' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
              >
                <input ref={fileInputRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-lg font-medium text-gray-700">点击或拖拽图片到此处</p>
                <p className="mt-2 text-sm text-gray-400">支持 JPG、PNG、WebP、GIF · 最大 10MB</p>
              </div>
            )}

            {/* 裁剪编辑区 */}
            {(state === 'editing' || state === 'processing' || state === 'done') && originalPreview && imgDimensions.w > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">拖动裁剪</h3>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">拖动白色方框调整位置</span>
                  </div>
                  <button onClick={resetUpload} className="text-sm text-blue-600 hover:text-blue-700 font-medium cursor-pointer">↻ 重新上传</button>
                </div>

                <DraggableCropArea
                  imgSrc={originalPreview}
                  naturalWidth={imgDimensions.w}
                  naturalHeight={imgDimensions.h}
                  cropPosition={cropPosition}
                  onCropChange={onCropChange}
                  onCropEnd={onCropEnd}
                />

                {originalFile && (
                  <p className="mt-2 text-xs text-gray-400 text-right">原始大小：{imgDimensions.w} × {imgDimensions.h} · {(originalFile.size / 1024).toFixed(1)} KB</p>
                )}
              </div>
            )}

            {/* 功能说明卡片 */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
              <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">✨ 功能特点</h3>
              <ul className="space-y-3">
                {[
                  { icon: '👆', text: '自由拖动裁剪框，自定义截取你想要的区域' },
                  { icon: '📐', text: '输出尺寸固定为 300×300 像素' },
                  { icon: '🗜️', text: '自动压缩至 200KB 以内，保持画质清晰' },
                  { icon: '🔒', text: '所有处理在浏览器本地完成，保护隐私安全' },
                ].map(item => (
                  <li key={item.text} className="flex items-start gap-3 text-sm text-gray-600">
                    <span className="mt-0.5">{item.icon}</span><span>{item.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* 右栏 */}
          <div className="lg:sticky lg:top-6">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 min-h-[360px] flex flex-col">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">裁剪结果</h3>

              {state === 'idle' && (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                  <svg className="w-24 h-24 mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={0.8} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <p className="text-sm">上传图片后在此预览</p>
                </div>
              )}

              {(state === 'editing' || state === 'processing') && !result && (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <Spinner />
                  <p className="mt-4 text-sm text-gray-500 font-medium">正在处理...</p>
                </div>
              )}

              {state === 'processing' && result && (
                <div className="flex-1 flex flex-col items-center justify-center">
                  <Spinner />
                  <p className="mt-4 text-sm text-gray-500 font-medium">更新裁剪区域...</p>
                </div>
              )}

              {state === 'done' && result && (
                <div className="flex-1 flex flex-col items-center">
                  <div className="w-52 h-52 rounded-2xl overflow-hidden shadow-md ring-4 ring-gray-100">
                    <img src={result.dataUrl} alt="裁剪结果" className="w-full h-full object-cover" />
                  </div>
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
                    <button onClick={downloadImage} className="w-full py-3.5 px-4 bg-gray-900 hover:bg-gray-800 text-white font-semibold rounded-xl transition-colors cursor-pointer text-sm flex items-center justify-center gap-2 active:scale-[0.98] active:transition-transform">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      {isWeChatBrowser() ? '保存头像' : '下载头像'}
                    </button>

                    {/* 微信/移动端专属：全屏保存弹窗 */}
                    {showSaveModal && (
                      <div className="fixed inset-0 z-[9999] bg-black/95 flex flex-col items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setShowSaveModal(false)}>
                        {/* 关闭按钮 */}
                        <button
                          onClick={() => setShowSaveModal(false)}
                          className="absolute top-5 right-5 w-10 h-10 rounded-full bg-white/15 flex items-center justify-center text-white/80 hover:bg-white/25 cursor-pointer transition-colors"
                        >
                          ✕
                        </button>

                        {/* 大标题提示 */}
                        <div className="text-center mb-6">
                          <p className="text-white font-bold text-xl mb-2">长按下方图片</p>
                          <p className="text-white/60 text-base">选择「保存图片」到相册</p>
                          {isWeChatBrowser() && (
                            <p className="mt-2 text-green-400 text-sm font-medium">💡 微信内请长按图片 → 存储到手机</p>
                          )}
                        </div>

                        {/* 全屏大图（确保足够大，方便长按触发） */}
                        <img
                          src={saveDataUrl || result?.dataUrl}
                          alt="长按保存裁剪结果"
                          className="w-72 h-72 rounded-2xl shadow-2xl select-none touch-none"
                          style={{ WebkitTouchCallout: 'default', WebkitUserSelect: 'text' }}
                          draggable={false}
                        />

                        {/* 底部二次提示 */}
                        <p className="mt-8 text-white/40 text-xs">👆 长按上方图片 → 保存到相册 · 点击空白处关闭</p>
                      </div>
                    )}
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
                  <button onClick={() => { setState('idle'); setError(''); }} className="mt-4 text-sm text-gray-500 hover:text-gray-700 underline cursor-pointer">重新尝试</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* 页脚 */}
      <footer className="py-6 text-center text-xs text-gray-400 border-t border-gray-200 bg-white">
        所有图片处理均在浏览器本地完成，不会上传到服务器
      </footer>
    </div>
  )
}

/** 加载动画 */
function Spinner() {
  return <div className="w-12 h-12 border-[3px] border-gray-200 border-t-gray-900 rounded-full animate-spin" />
}

export default App
