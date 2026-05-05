# Thread Search with Jieba

使用jieba进行中文分词和关键词提取，以实现线程搜索功能，这是最为方便的功能之一，用户可以直接搜索关键词来找到相关的对话内容。

最终 UI 上也可以呈现出关键词高亮（加粗）的效果，提升用户体验。

## Usage

```ts
import { Jieba } from '@node-rs/jieba'
// ["我们", "中", "出", "了", "一个", "叛徒"]
import { Jieba, TfIdf } from '@node-rs/jieba'
import { dict, idf } from '@node-rs/jieba/dict'

// load jieba with the default dict
const jieba = Jieba.withDict(dict)

console.info(jieba.cut('我们中出了一个叛徒', false))

const jieba = Jieba.withDict(dict)
const tfIdf = TfIdf.withDict(idf)

tfIdf.extractKeywords(
  jieba,
  '今天纽约的天气真好啊，京华大酒店的张尧经理吃了一只北京烤鸭。后天纽约的天气不好，昨天纽约的天气也不好，北京烤鸭真好吃',
  3,
)

// [
//   { keyword: '北京烤鸭', weight: 1.3904870323222223 },
//   { keyword: '纽约', weight: 1.121759684755 },
//   { keyword: '天气', weight: 1.0766573240983333 }
// ]
```
