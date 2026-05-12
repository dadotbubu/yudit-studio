#!/usr/bin/env python3
import os
import json
from datetime import datetime
from supabase import create_client

# Supabase 설정
SUPABASE_URL = 'https://vihrydqudawrlwddffwa.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpaHJ5ZHF1ZGF3cmx3ZGRmZndhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNTcxNjIsImV4cCI6MjA5MTgzMzE2Mn0.5QkOjtl25PgbCDenWNgyqelbgPeerg6sqROQa624G9A'

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# 테스트 데이터 (1개만)
month = "2026-05"

test_plan = {
    "id": "p_2026-05_001",
    "week": 1,
    "category": "Career Guide",
    "title": "대기업 신입 첫 출근 준비",
    "description": "• 준비물 체크리스트\n• 복장 가이드\n• 첫 출근 루틴",
    "createdAt": datetime.now().isoformat() + "Z",
    "createdBy": "claude"
}

# 기존 데이터 로드
result = supabase.table('studio_data').select('data').eq('key', 'plans').execute()
plans_data = result.data[0]['data'] if result.data else {}

# 월별 데이터 병합
if month not in plans_data:
    plans_data[month] = {"plans": [], "ideas": []}

plans_data[month]["plans"] = [test_plan]

# 저장
supabase.table('studio_data').upsert({
    'key': 'plans',
    'data': plans_data,
    'updated_at': datetime.now().isoformat()
}).execute()

print(f"✅ 테스트 계획 1개 등록 완료: {test_plan['title']}")
