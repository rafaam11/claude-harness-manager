// 항목별(기사/레포) "읽음 시각 + 숨김" 상호작용 상태. News/GitHub Stars가 값 shape만 공유하고
// 저장소(store)·라우트·로직은 완전히 독립이다(translate-types.ts의 TranslateReason 추출과 동일 이유).

export interface ItemInteractionState {
  /** 마지막으로 상세를 연 epoch ms. 없으면 "읽지 않음". */
  lastReadAt?: number;
  /** 목록에서 숨김 처리됨. */
  hidden?: boolean;
}

/** id(기사) 또는 fullName(레포) → 상태. */
export type ItemStateMap = Record<string, ItemInteractionState>;
