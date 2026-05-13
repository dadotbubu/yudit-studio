// 모든 콘텐츠에서 "아이디어" 마일스톤 제거
// 브라우저 콘솔(F12)에 복붙해서 실행

(async function() {
  console.log('🗑️  아이디어 마일스톤 제거 시작...');

  let removed = 0;

  contentsData.contents.forEach(content => {
    if (!content.milestones) return;

    const before = content.milestones.length;
    content.milestones = content.milestones.filter(m => m.status !== '아이디어');
    const after = content.milestones.length;

    if (before > after) {
      removed += (before - after);
      console.log(`  - ${content.title}: ${before - after}개 제거`);
    }
  });

  if (removed > 0) {
    console.log(`\n💾 총 ${removed}개 아이디어 마일스톤 제거됨. 저장 중...`);
    await saveAllData();

    // 캘린더 동기화 (삭제된 마일스톤 반영)
    reconcileCalendarMilestones();

    console.log('✅ 완료! 새로고침하세요.');
  } else {
    console.log('✅ 제거할 아이디어 마일스톤 없음');
  }
})();
