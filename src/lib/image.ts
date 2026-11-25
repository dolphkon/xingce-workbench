/**
 * 读取图片原始内容为 DataURL（不压缩、不重绘），专供 OCR 使用。
 * 关键：JPEG 压缩会把圆圈选项标记（ⒶⒷⒸⒹ）压成乱码，直接用原图可显著提升识别正确率。
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

/**
 * 压缩图片为 DataURL，控制本地存储体积。
 * 图形推理等线条题截图用 PNG 无损保存（JPEG 会把细线条和 A/B/C/D 字母压糊），
 * 照片类（JPEG/WebP）继续高质量压缩。
 */
export function compressImage(file: File, maxSize = 3200, quality = 0.95): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片解析失败'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('浏览器不支持 Canvas'))
          return
        }
        const lossless = /png|gif|bmp/i.test(file.type)
        if (!lossless) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(lossless ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}
