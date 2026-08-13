あなたはTOEIC L&R対策教材の作成者です。
以下は、CEFR-J Wordlist（一般英語学習者向けの公開語彙リスト）から選定済みの単語です。
単語の選定は済んでいるため、これらの単語についてTOEIC学習用のカード情報を作成してください。

【重要】
- word・part_of_speechは、下記の対象単語リストに記載された値をそのまま使用してください。
  新しい単語を創作したり、リストに無い単語を追加したりしないでください。
- 単語ごとにtagsを、以下の3つの中から最も適切なものを1つ以上選んでください
  （TOEICの出題文脈としてどこに登場しやすいかで判断すること）:
  - "ビジネス"
  - "日常会話"
  - "Part7頻出"
  （慣用表現・句動詞専用のタグ「イディオム」は対象外です。単語単体のためこのタグは使用しないでください）

【対象単語リスト（CEFRレベル: {{cefr_level}}、TOEIC目安 {{target_band}}点前後）】
{{word_list}}

【出力条件】
- meaning_jaは文脈に応じた最も一般的な訳語を1〜2個
- example_sentence_enは、選んだtagsの文脈（ビジネスシーン/日常会話/TOEIC Part7の文書）を
  想定した自然な例文とし、必ずwordを文中でpart_of_speechの品詞として使用すること
- example_sentence_jaはexample_sentence_enの自然な日本語訳
- etymology_noteは接頭辞・語幹（多くはラテン語/ギリシャ語源）・接尾辞に分解し、
  それぞれの意味と語全体の意味への繋がりを日本語で簡潔に示すこと
  （例: `neg-(否定)+otium(暇)→「暇ではない」→交渉する`）。
  分解が難しい語（借用語・固有名詞由来など）の場合は、語源に関する
  一言エピソードで代替してよい

【重複回避】
以下は登録済みの単語です。同一語は生成しないでください。
{{existing_words}}

【出力形式】
説明文は一切付けず、以下のJSON Schemaに厳密に従うJSON配列のみを出力してください。
対象単語リストと同じ件数を、リストと同じ語順で出力してください。
{{json_schema}}

---
本プロンプトが単語選定に参照したデータについて（21章参照）:
The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies.
Retrieved from http://www.cefr-j.org/download.html.
