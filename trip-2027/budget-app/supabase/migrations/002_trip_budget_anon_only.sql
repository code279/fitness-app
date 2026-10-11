-- 여행 앱은 로그인 없이 anon 으로만 부른다. 로그인 사용자 쪽 창구는 닫아 둔다.
revoke execute on function public.trip_load(text) from authenticated;
revoke execute on function public.trip_add_expense(text, uuid, text, text, text, bigint, text, timestamptz, text) from authenticated;
revoke execute on function public.trip_add_expenses(text, jsonb) from authenticated;
revoke execute on function public.trip_update_expense(text, uuid, uuid, text, text, text, bigint, text, timestamptz) from authenticated;
revoke execute on function public.trip_delete_expense(text, uuid) from authenticated;
revoke execute on function public.trip_add_topup(text, uuid, bigint, text, date) from authenticated;
revoke execute on function public.trip_delete_topup(text, uuid) from authenticated;
revoke execute on function public.trip_update_wallet(text, uuid, text, text, text) from authenticated;
