import { TextSegment } from '@/types/agent';

/**
 * 文本处理工具类
 */
export class TextProcessor {
  /**
   * 将文本分割为句子
   * @param text 输入文本
   * @returns 句子数组
   */
  public static splitIntoSentences(text: string): TextSegment[] {
    // 中文标点符号分割规则
    const sentenceDelimiters = /([。！？；])/g;
    
    let sentences: TextSegment[] = [];
    let lastIndex = 0;
    let match;
    
    // 使用正则表达式匹配句子结束标记
    const regex = new RegExp(sentenceDelimiters);
    while ((match = regex.exec(text)) !== null) {
      const endIndex = match.index + match[0].length;
      const sentence = text.substring(lastIndex, endIndex);
      
      if (sentence.trim()) {
        sentences.push({
          content: sentence,
          start: lastIndex,
          end: endIndex,
          type: 'sentence'
        });
      }
      
      lastIndex = endIndex;
    }
    
    // 处理最后一部分文本（如果没有以标点符号结束）
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      if (remainingText.trim()) {
        sentences.push({
          content: remainingText,
          start: lastIndex,
          end: text.length,
          type: 'sentence'
        });
      }
    }
    
    return sentences;
  }

  /**
   * 将文本分割为段落
   * @param text 输入文本
   * @returns 段落数组
   */
  public static splitIntoParagraphs(text: string): TextSegment[] {
    const paragraphs = text.split(/\n\s*\n/);
    
    let segments: TextSegment[] = [];
    let currentIndex = 0;
    
    for (const paragraph of paragraphs) {
      const trimmedParagraph = paragraph.trim();
      if (trimmedParagraph) {
        // 查找原始文本中段落的实际位置
        const startIndex = text.indexOf(trimmedParagraph, currentIndex);
        if (startIndex !== -1) {
          const endIndex = startIndex + trimmedParagraph.length;
          segments.push({
            content: trimmedParagraph,
            start: startIndex,
            end: endIndex,
            type: 'paragraph'
          });
          currentIndex = endIndex;
        }
      }
    }
    
    return segments;
  }

  /**
   * 检测重复字词
   * @param text 输入文本
   * @returns 重复字词位置数组
   */
  public static findRepeatedWords(text: string): { word: string, start: number, end: number }[] {
    const repeats: { word: string, start: number, end: number }[] = [];
    
    // 匹配连续重复的单字或词语
    const regex = /(.{1,5})\1+/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
      const fullMatch = match[0];
      const repeatedWord = match[1];
      
      // 排除一些常见的重复，如"的的"可能是有意义的
      if (repeatedWord.length > 1 || !['的', '了', '地', '得'].includes(repeatedWord)) {
        repeats.push({
          word: fullMatch,
          start: match.index,
          end: match.index + fullMatch.length
        });
      }
    }
    
    return repeats;
  }

  /**
   * 提取上下文
   * @param text 完整文本
   * @param start 开始位置
   * @param end 结束位置
   * @param contextLength 上下文长度
   * @returns 上下文对象
   */
  public static extractContext(text: string, start: number, end: number, contextLength: number = 20): {
    before: string;
    after: string;
    fullSentence: string;
  } {
    // 提取前后文本
    const before = text.substring(Math.max(0, start - contextLength), start);
    const after = text.substring(end, Math.min(text.length, end + contextLength));
    
    // 尝试提取完整句子
    const sentenceStart = Math.max(0, text.lastIndexOf('。', start) + 1);
    const sentenceEnd = text.indexOf('。', end);
    const fullSentence = text.substring(
      sentenceStart,
      sentenceEnd !== -1 ? sentenceEnd + 1 : text.length
    );
    
    return {
      before,
      after,
      fullSentence: fullSentence || text.substring(start, end)
    };
  }
}
