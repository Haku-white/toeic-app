create table generation_batches (
  id uuid primary key default gen_random_uuid(),
  content_type content_type not null,
  model_name text not null,
  prompt_version text not null,
  requested_count int not null,
  generated_count int not null default 0,
  committed_count int not null default 0,
  needs_review_count int not null default 0,
  rejected_count int not null default 0,
  status batch_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);
