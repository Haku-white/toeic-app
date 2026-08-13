# CEFR-J Wordlist（データソース）

`cefrj-vocabulary-profile-1.5.csv` は [openlanguageprofiles/olp-en-cefrj](https://github.com/openlanguageprofiles/olp-en-cefrj)（`master`ブランチ）から取得したスナップショットです。取得日: 2026-08-13。

`import_cefrj_wordlist.ts`（`scripts/content-generation/`）が単語選定候補の抽出に使用します（DESIGN.md 21章参照）。実行時にネットワークアクセスせずに再現できるよう、CSVはこのリポジトリにコミットしています。

## 引用（出典明記）

> The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html on 2026-08-13.

## ライセンス

CEFR-J vocabulary profile datasets can be used for research and commercial purposes with no charge, provided that you cite the dataset properly. The copyright belongs to Tono Laboratory at TUFS (Tokyo University of Foreign Studies).

（出典: [olp-en-cefrj README](https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/README.md)）

## 収録範囲

このプロジェクトでは、CSVの`headword, pos, CEFR`列のみを使用します（`CoreInventory 1`/`CoreInventory 2`/`Threshold`列は一部行にのみ値がある補助情報のため未使用）。C1/C2レベルを含む[Octanove Vocabulary Profile](https://github.com/openlanguageprofiles/olp-en-cefrj/blob/master/octanove-vocabulary-profile-c1c2-1.0.csv)は別ライセンス（CC BY-SA 4.0）のため、今回のスコープには含めていません（DESIGN.md 21.1参照）。
