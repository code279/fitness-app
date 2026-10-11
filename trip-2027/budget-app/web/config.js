// Supabase 공개용 키다. 이 키만으로는 아무것도 읽을 수 없고, 데이터는 여행 코드로 지킨다.
export const SUPABASE_URL = 'https://nzohrverxabeholjuzuf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_QCJ3AWA_xe0vqwfvHM0ImQ_Ar1XX320';

// 사진 글자인식(Tesseract.js)은 사진 인식을 처음 누를 때만 내려받는다.
export const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

export const CATEGORIES = ['숙소', '교통', '식사', '간식·편의점', '쇼핑', '관광', '기타'];
export const CATEGORY_ICON = {
  '숙소': 'bed-double', '교통': 'train-front', '식사': 'utensils', '간식·편의점': 'store',
  '쇼핑': 'shopping-bag', '관광': 'ticket', '기타': 'ellipsis',
};
