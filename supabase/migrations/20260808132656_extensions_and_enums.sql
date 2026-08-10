-- 拡張機能
create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- バッチ生成
create type content_type as enum ('vocab', 'grammar');
create type batch_status as enum ('pending', 'generating', 'validating', 'needs_review', 'completed', 'failed');
create type item_status as enum ('pending_validation', 'auto_passed', 'needs_review', 'approved', 'rejected', 'committed');

-- 語彙SRS（FSRS）
create type fsrs_state as enum ('new', 'learning', 'review', 'relearning');
create type fsrs_rating as enum ('again', 'hard', 'good', 'easy');

-- 文法ドリル
create type toeic_part as enum ('part5', 'part6', 'part7', 'listening', 'general');
