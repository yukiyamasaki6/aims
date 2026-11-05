# -*- coding: utf-8 -*-
# セグメント: 名前 -> [(ファイル末尾, 範囲)]
def seg(spec):
    out=[]
    for part in spec.split(';'):
        part=part.strip()
        if not part: continue
        f,r=part.rsplit('|',1)
        out.append((f.strip(), [tuple(map(int,x.split('-'))) for x in r.split(',')] if r!='all' else None))
    return out
SEG={k:seg(v) for k,v in {
# root-client-entry
"APP_in":"app/root-client-entry.tsx|1-87","APP_rec":"app/root-client-entry.tsx|88-124","APP_stores":"app/root-client-entry.tsx|125-166","APP_sync":"app/root-client-entry.tsx|167-186","APP_off":"app/root-client-entry.tsx|187-198","APP_order":"app/root-client-entry.tsx|199-212","APP_start":"app/root-client-entry.tsx|213-218","APP_render":"app/root-client-entry.tsx|219-231",
# auth
"SES_out":"auth/application/session.ts|1-112","SES_watch":"auth/application/session.ts|102-137","SEF_out":"auth/domain/session-end-flow.ts|1-70","SEF_leave":"auth/domain/session-end-flow.ts|71-81",
"ACH_ident":"auth/domain/auth-change.ts|1-36","ACH_lost":"auth/domain/auth-change.ts|37-47",
"SA_call":"supabase-auth.ts|1-67,85-94,128-169","SA_sub":"supabase-auth.ts|68-75,170-188","SA_read":"supabase-auth.ts|76-84,95-127,189-229",
"AR_rules":"auth-routes.ts|1-72","AR_redirect":"auth-routes.ts|73-94",
"PS_send":"password-setup.ts|1-47,62-81","PS_resend":"password-setup.ts|48-61,82-91","PS_verify":"password-setup.ts|92-110","PS_apply":"password-setup.ts|111-126",
"PF_send":"password-setup-flow.ts|1-99","PF_resend":"password-setup-flow.ts|112-128","PF_verify":"password-setup-flow.ts|100-111","PF_set":"password-setup-flow.ts|129-140","PF_reduce":"password-setup-flow.ts|141-228",
"AC_verify":"domain/auth-code.ts|1-17","AC_resend":"domain/auth-code.ts|18-24",
"OC_verify":"otp-code-step.tsx|1-127","OC_resend":"otp-code-step.tsx|128-157","PSF_pw":"password-setup-form.tsx|145-194","PSF_frame":"password-setup-form.tsx|1-144",
"SRV_admin":"supabase/infrastructure/server.ts|1-24","SRV_server":"supabase/infrastructure/server.ts|25-46",
# sync
"RS_start":"round-sync.ts|1-71,328-352","RS_auth":"round-sync.ts|353-359","RS_online":"round-sync.ts|318-327,360-363","RS_offline":"round-sync.ts|364-366","RS_vis":"round-sync.ts|367-370","RS_notify":"round-sync.ts|371-379","RS_resident":"round-sync.ts|72-99,121-155","RS_list":"round-sync.ts|100-111","RS_open":"round-sync.ts|112-120,209-225","RS_refetch":"round-sync.ts|156-208","RS_eval":"round-sync.ts|226-317",
"ST_auth":"sync-trigger.ts|1-18","ST_dec":"sync-trigger.ts|19-33",
# hub
"HUB_life":"round-record-hub.ts|1-72,90-102,261-293,314-315","HUB_reload":"round-record-hub.ts|122-148","HUB_notify":"round-record-hub.ts|73-89,332-339","HUB_append":"round-record-hub.ts|149-180,340-345","HUB_commit":"round-record-hub.ts|181-222","HUB_adopt":"round-record-hub.ts|103-121,346-349","HUB_apply":"round-record-hub.ts|350-385","HUB_discard":"round-record-hub.ts|386-393","HUB_inflight":"round-record-hub.ts|394-400","HUB_diverged":"round-record-hub.ts|401-407","HUB_read1":"round-record-hub.ts|294-304","HUB_readall":"round-record-hub.ts|305-313","HUB_list":"round-record-hub.ts|223-260,316-331",
"RR_base":"domain/round-record.ts|1-82","RR_append":"domain/round-record.ts|83-113","RR_adopt":"domain/round-record.ts|114-256","RR_commit":"domain/round-record.ts|257-276","RR_apply":"domain/round-record.ts|277-308","RR_retire":"domain/round-record.ts|309-323","RR_inflight":"domain/round-record.ts|324-335","RR_derive":"domain/round-record.ts|336-393",
"OS_plan":"op-sender.ts|1-81,142-184","OS_run":"op-sender.ts|82-141","OS_hub":"op-sender.ts|185-188","OS_loaded":"op-sender.ts|189-196","OS_online":"op-sender.ts|197-206","OS_life":"op-sender.ts|207-243","OS_resume":"op-sender.ts|244-253",
"SQ_plan":"send-queue.ts|1-178","SQ_run":"send-queue.ts|179-248","SQ_resume":"send-queue.ts|249-270","SQ_online":"send-queue.ts|271-276",
"TR_common":"round-op-transport.ts|1-103,144-162,293-312","TR_round":"round-op-transport.ts|104-113,163-207","TR_dist":"round-op-transport.ts|114-143,208-247","TR_shots":"round-op-transport.ts|248-292",
"IDB_conn":"indexeddb-op-log-store.ts|1-108,205-214","IDB_append":"indexeddb-op-log-store.ts|109-130","IDB_read":"indexeddb-op-log-store.ts|131-152,262-320","IDB_commit":"indexeddb-op-log-store.ts|153-182,215-261","IDB_ack":"indexeddb-op-log-store.ts|183-195","IDB_retire":"indexeddb-op-log-store.ts|196-204",
"RF_types":"round-fetching.ts|1-95","RF_ref":"round-fetching.ts|96-127","RF_tf":"round-fetching.ts|128-135,192-203","RF_preset":"round-fetching.ts|136-141","RF_detail":"round-fetching.ts|142-162","RF_details":"round-fetching.ts|163-182","RF_list":"round-fetching.ts|183-191",
"RQ_common":"round-queries.ts|1-139,149-158","RQ_tf":"round-queries.ts|140-148,252-258","RQ_preset":"round-queries.ts|259-272","RQ_detail":"round-queries.ts|191-215","RQ_details":"round-queries.ts|159-190,216-235","RQ_list":"round-queries.ts|236-251",
"CF_run":"content-fetcher.ts|1-80","CF_time":"content-fetcher.ts|81-110",
"REQ_open":"refresh-requests.ts|1-90,93-113","REQ_list":"refresh-requests.ts|91-92,149-195","REQ_watch":"refresh-requests.ts|114-148,196-224",
"BR_all":"round-base-refreshing.ts|27-110","BR_one":"round-base-refreshing.ts|1-26,111-157","RC_need":"round-refresh-control.ts|1-106,118-122","RC_sub":"round-refresh-control.ts|107-117",
"RH_main":"round-handle.ts|1-216,231-239","RH_release":"round-handle.ts|217-230",
"OA_core":"round-op-apply.ts|1-74,275-281,416-482","OA_round":"round-op-apply.ts|75-139","OA_dist":"round-op-apply.ts|140-274","OA_shot":"round-op-apply.ts|282-415",
"USI_score":"use-shot-input.ts|1-63,103-147","USI_clear":"use-shot-input.ts|64-81","USI_replay":"use-shot-input.ts|82-102",
"SO_score":"shot-operations.ts|1-29,42-65","SO_clear":"shot-operations.ts|30-41","SO_replay":"shot-operations.ts|66-92","SO_pending":"shot-operations.ts|93-118",
"SP_adv":"domain/shot-pointer.ts|1-73","SP_rec":"domain/shot-pointer.ts|74-91","SH_nav":"domain/score-history.ts|29-58","SH_keep":"domain/score-history.ts|1-28,59-64",
"SC_sum":"scorecard-scoring.ts|134-216,229-254","SC_rules":"scorecard-scoring.ts|1-133","SC_keys":"scorecard-scoring.ts|217-228",
"KP_state":"ui/use-keypad.ts|1-88,116-182","KP_scroll":"ui/use-keypad.ts|89-115",
"DO_add":"distance-operations.ts|1-48","DO_upd":"distance-operations.ts|49-91","DO_dis":"distance-operations.ts|92-97",
"RL_complete":"round-leaving.ts|1-35,43-44","RL_delete":"round-leaving.ts|36-39","RL_leave":"round-leaving.ts|40-42",
"RP_status":"round-progress.ts|1-34","RP_reopen":"round-progress.ts|35-86","RP_disable":"round-progress.ts|87-92",
"RLS_list":"rounds-list-store.ts|1-45,71-133","RLS_local":"rounds-list-store.ts|46-70","RLi_list":"round-list.ts|1-75","RLi_local":"round-list.ts|76-97",
"RPS_view":"round-preset-select.tsx|1-86,122-138","RPS_del":"round-preset-select.tsx|139-164","RPS_start":"round-preset-select.tsx|87-121",
"PCm_save":"infrastructure/preset-commands.ts|1-26,43-56","PCm_del":"infrastructure/preset-commands.ts|27-42","WR_del":"write-result.ts|1-6","WR_save":"write-result.ts|7-8",
"UA_click":"update-activation.ts|1-117,128-167","UA_path":"update-activation.ts|168-182","UA_hold":"update-activation.ts|118-127",
"NC_frame":"apps/web/next.config.ts|31-44,50-57","NC_local":"apps/web/next.config.ts|1-30,45-49","SW_conf":"app/sw.ts|1-36,48-50","SW_fallback":"app/sw.ts|37-47","RCH_frame":"runtime-caching.ts|18-24","RCH_assets":"runtime-caching.ts|1-17,25-50",
"U_trigger":"20261016000000_users.sql|44-57,104-110","U_decl":"20261016000000_users.sql|1-43,72-103","U_updated":"20261016000000_users.sql|58-71",
"DBr_decl":"000200_rounds.sql|1-208,1421-1620","DB_clear":"000200_rounds.sql|209-322","DB_createdist":"000200_rounds.sql|323-392","DB_distguard":"000200_rounds.sql|634-659","DB_createround":"000200_rounds.sql|393-545","DB_disdist":"000200_rounds.sql|546-596","DB_disround":"000200_rounds.sql|597-633","DB_auth":"000200_rounds.sql|660-687","DB_record":"000200_rounds.sql|688-966","DB_shotfit":"000200_rounds.sql|967-1020","DB_updist":"000200_rounds.sql|1021-1245","DB_upround":"000200_rounds.sql|1246-1420",
"DB_tf_decl":"target_faces.sql|1-112","DB_tf_data":"target_faces.sql|113-412","DB_pr_decl":"preset_rounds.sql|1-43,76-174","DB_pr_save":"preset_rounds.sql|44-75",
}.items()}
