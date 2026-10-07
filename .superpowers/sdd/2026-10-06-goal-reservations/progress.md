# SDD ledger - plan: docs/superpowers/plans/2026-10-06-goal-reservations.md

Start commit: 6f17870; isolated branch: codex/goal-reservations.
Baseline: npm test exit 0, 2 Node tests and 10 Vitest tests.
User-approved: combined reserved + spent progress; subagent task review; no push before final check.

## Preflight scan

| Task / interface pair | Check | Result |
|---|---|---|
| Task 1 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 2 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 3 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 4 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 5 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 6 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 7 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 8 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 9 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 10 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| Task 11 | Files, assertions, outputs and constraints | Consistent; execution evidence still required |
| 1/3 schema and RPC types | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/4 transaction rows and owner keys | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/5 lifecycle and event reversal keys | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 1/10 migration and restricted permissions | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 2/3 amount and snapshot contracts | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 2/6 pure totals and projections | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/4 shared apply RPC and deterministic locks | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/5 shared apply RPC and idempotency | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 3/6 snapshot shape and transport | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/5 transaction reversal references | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/6 quote and command contracts | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 4/8 quote confirmation and retry | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/7 lifecycle actions and goal status | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/8 transaction deletion command | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 5/10 lifecycle migration and legacy adoption | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/7 use-goals snapshot and components | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/8 transport and shared financial refresh | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 6/9 cache and wallet snapshot | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 7/8 Spend shortcut and AddTransactionModal | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 7/10 legacy card actions and goals page | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 8/10 AddTransactionModal and legacy safety | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |
| 9/10 balance writer removal and grants | Producer/consumer names and behaviors | Consistent; use shared contracts in briefs |

## Local environment

Disposable native PostgreSQL/PostgREST provisioning under investigation. Live .env must not be used for writes. No service-role key found in local environment.

## Tasks
Task 1: pending; Task 2: pending; Task 3: pending; Task 4: pending; Task 5: pending; Task 6: pending; Task 7: pending; Task 8: pending; Task 9: pending; Task 10: pending; Task 11: pending.

Ruling: Use native local PostgreSQL + PostgREST for financial integration tests, with direct-SQL auth fixtures and signed JWTs - no local Supabase stack is installed and real locks/roles are required - this does not verify GoTrue signup or hosted Supabase-specific deployment configuration.
Ruling: Store ledger deltas as exact NUMERIC with explicit two-decimal scale and numeric(15,2)-equivalent range checks - fixed-scale NUMERIC silently rounds invalid 1.001 inputs before constraints inspect them - requires matching validation in RPCs and documented schema types.
Ruling: Run database test files serially with --test-concurrency=1 while explicit race tests issue concurrent requests - schema and permission migration tests share the disposable database - slightly slower suite, avoiding test infrastructure races without weakening concurrency assertions.

User steering: stop after Task 2 (including independent reviews). Tasks 3-11 must not be dispatched. Retain workspace/ledger for resume.
Task 1: implemented at 44d4bd0; awaiting independent review.
Task 1: fix round 1/5 started; Important open: service_role TRUNCATE privilege bypasses immutable event trigger; review head 44d4bd0.
Task 1 cross-task item: live schema/deletion RPC inspection remains a documented deployment preflight; no live migration/push is authorized.
Ruling: Retain legacy funding helper exports until Task 6 reader cutover and permit only a projection delegation wrapper in use-goals during Task 2 - existing modal/hook callers must keep working at this partial stopping point - legacy transaction-based UI behavior remains until the rest of the plan is executed.
Task 1: fix round 1/5 implemented at db1e3ea; TRUNCATE denied and rollback-preserved history test added; awaiting scoped re-review.
Ruling: Finance snapshots override Goal row monetary properties with decimal-string types - inheriting numeric database row properties contradicted exact-money API boundaries - downstream hook/display adapters must consume the clarified DTO rather than assume raw table types.
Task 1: fix round 1/5 (1 addressed, 0 open; commits 44d4bd0..db1e3ea; independent re-review clean).
Task 1: complete (commits 6f17870..db1e3ea, review clean; deployed-schema preflight explicitly deferred to deployment).
Task 2: implementing; base 8c23f80; fresh task_2_summary implementer.
Ruling: Expand Vitest discovery minimally to .test.ts and .test.tsx - existing config excludes the planned pure TypeScript tests - more TypeScript tests become discoverable, Node .cjs/.mjs suites remain separate.
Task 2: implemented at 80be291; pending independent review.
User asked about lower-tier subagents; preference question pending. Routine Task2 review candidate gpt-6-luna; sensitive SQL review gpt-6.1-sol default if chosen.
Controller verification at 80be291: npx tsc --noEmit exit0; npm test2Node+44Vitest exit0; npm run test:db10/10 native PostgreSQL/PostgREST exit0.
Model assumption while preference question is unanswered: use gpt-6-luna high for the remaining routine Task2 review; retain gpt-6.1-sol for sensitive SQL reviews on future resume. This is a controller default, not a submitted user selection.
User model preference confirmed: GPT-6-luna xhigh for routine work/testing/review; GPT-6.1-sol medium for task implementations going forward.
Task 2: independent review dispatched to review_task_2 (gpt-6-luna xhigh), head80be291.
Controller final local checks at80be291: npm run lint exit0 (six exhaustive-deps warnings in unchanged source files); npm run build exit0 (20 static pages generated; existing font fallback, Supabase Edge API, Browserslist/cache warnings).
Task 2 review remains pending; all product files are unchanged since reviewed head80be291. No Task3+ dispatched.
User final model policy: no Astra; GPT-6.1-sol only low or medium, medium is highest allowed; GPT-6-luna xhigh when capable. Controller chooses role by complexity/value, not all-Luna or all-Sol. Overrides prior skill model-tier recommendations.
Task 2 review Important open: installment count up to billions can allocate enormous arrays; fix practical cap matching current modal validation in both draft schema and helper.
Ruling: Cap installments at 12 using the existing modal choices (1..12) and one shared schema/helper constant - valid counts in the billions can exhaust memory before any financial write - longer repayment plans would require an explicit coordinated UI/API policy change.
Task 2 fix round 1: use fresh Luna xhigh fixer instead of resuming original Sol high implementer - user now prohibits Sol above medium and requests value-based model routing.
User refinement: Luna reasoning floor medium; choose medium/high/xhigh as needed, not always xhigh. Sol remains low/medium only; no Astra. Use value-based role/task judgment.
Controller fresh verification after installment fix: npx tsc --noEmit exit0; npm test 47 Vitest + 2 Node exit0; npm run test:db 10/10 native PostgreSQL/PostgREST exit0; npm run lint exit0 (same six pre-existing exhaustive-deps warnings); npm run build exit0, 20 pages generated. Scoped fix review still pending; no Task3+ work.
Task 2: fix round 1/5 (1 addressed, 0 open; commits 80be291..3afa4a6; scoped Luna medium re-review clean).
Task 2: complete (commits 8c23f80..3afa4a6, review clean; fresh TSC/tests/database/lint/build checks recorded above).
Review process note: scoped reviewer appended its verdict to the ignored report despite read-only instructions; no product/index/branch mutation occurred, and controller instructed no further edits. Verdict also returned in final message.
Requested stopping boundary reached: Tasks 1-2 complete; Tasks 3-11 pending. Preserve worktree, plan workspace, and local test fixtures for resume. No push, merge, deployment, or live database migration.
User resumed local implementation on 2026-10-07, superseding the prior stop-after-Task2 boundary. Continue Tasks3-11 with task-scoped independent reviews, existing model ceilings, and no remote push/merge/deployment/live migration.
Task 3: implementing; base4fbf4ba; use Sol medium for security/concurrency SQL work. Existing isolated worktree and disposable local database are reused.
Ruling: Snapshot goals retain archived entries with archive metadata to resolve historical names; active presentation filters archived/closed entries in later reader/UI tasks - the shared snapshot has one goals array and cannot both erase archived names and retain them for history - consumers must explicitly apply the active filter.
Task 3: implemented at fff3e0b; reported24/24 real database tests and TSC exit0; independent Sol medium review pending.
Controller fresh app regression check atfff3e0b: npmtest exit0,47Vitest+2Node, no failures. Task3 independent review pending.
Task3 cross-task review checks resolved: quote/confirmation belongsTask4; lifecycleTask5; activeUI filteringTasks6-7; directwriter cutoverTask10. Not missing withinTask3 scope.
Task 3: complete (commits4fbf4ba..fff3e0b, independentSol medium review speccompliant/qualityApproved, nofindings).
Task 4: implementing; base3160ba2; task_4_transactions (Sol medium). Complex financial quoting/booking requires exact SQL concurrency validation; simpler reader/UI tasks will use Luna as appropriate.
Ruling: Allow a private reservation helper behind the public financial dispatcher when extending Task3 - later command families can reuse the existing tested lane rather than duplicate it inline - helpers must deny direct client execution and retain pinned paths; a bad delegation boundary could bypass authorization and is a required review concern.
User steering 2026-10-07: STOP after Task4 is complete, including independent review/fix loop and fresh local verification. Do not dispatchTasks5-11. Preserve worktree/ledger for resume.
Task 4: implemented at eff835d; report36/36 database tests,TSC exit0, fresh/repeatedschema verified; independent Sol medium review pending. Test harness may leave RPC at003 because reservations.test reapplies003; restore ordered schema after final suite before manual checks.
Task4 independent review: spec compliant / quality Approved with Minor recommendation at financial-transactions.test.mjs:156-158: race test should assert complete outcome-dependent balances/events/operations/transactions.
Ruling: Treat the missing full persisted race outcome as a confirmed acceptance-evidence gap and close it before stopping - the brief explicitly requires rollback assertions for every persisted balance/event/operation/transaction - small test-only strengthening costs one scoped fix/review, prevents claiming unverified race rollback. Implementation review found no blocker.
Task4 fix round1 started; fresh Luna medium agent for narrow test-only gap rather than reusing higher-cost Sol SQL implementer. Baseeff835d.
Controller fresh local checks at eff835d: TSCexit0, npmtest47Vitest+2Node exit0, npmrun test:db36/36 exit0, lint exit0 with same six existing exhaustive-deps warnings, productionbuild exit0/20pages (nonfatal edge-worker SIGTERM log followed by successful compilation). Ordered schema restored through004 after tests; zero goal-ledger fixture users remain. Narrow test-only race assertions fix/review pending.
Task4 fix round1/5: test-only strengthening at2ee49eb; scoped Luna medium reviewer confirms ADDRESSED, no new breakage or observations. Full controllerDB rerun36/36 exit0; ordered schema restored004.
Task4 cross-task checks resolved: pending lifecycle/reversalsTask5, UI/clientTasks6-9, directwriter cutoverTask10, renderedwholeflowTask11 are explicit remaining scopes. No Task5+ work started.
Task 4: complete (commits3160ba2..2ee49eb, independent review and scoped fix review clean; local checks recorded above).
Requested stopping boundary reached: Tasks1-4 complete; Tasks5-11 pending. Preserve worktree and all handoff artifacts; stop local database processes after checkpoint commit. No push/merge/deployment/live migration.
User resumed on2026-10-07: proceedTask6 onwards. Task5 is still pending and supplies required lifecycle/reversal commands; controller announced completing this prerequisite first, then continuing6-11. Prior stop-afterTask4 revoked. Same model ceilings, independent reviews, no push/merge/deployment/live migration.
Task 5: implementing; base6e1d50c. Sol medium for lifecycle/reversal financial SQL. Reader/transportTask6 will use Luna high unless complexity escalates.
Ruling: Delete only the selected installment transaction row and reverse its amount, preserving remaining scheduled rows - current deletion caller supplies one UUID and the legacy deployed function definition is unavailable - live RPC inventory must confirm semantics before deployment; changing group behavior now would silently delete unrelated scheduled records.
Ruling: Preserve zero-value allocation rejection; closed-goal reversals with no allocation-money effect are audited by the deletion financial_operation rather than a zero ledger event - zero events violate the spec and shared AllocationEventSchema - allocation-only history lacks a redundant no-money reversal marker, but operation/retained transaction references preserve the deletion audit.
Task5 implemented at00fc91d, reported19focused/55DB tests andTSC exit0; independent Sol medium review pending.
Task5 cross-task review checks resolved: deployed legacy RPC remains rollout preflight, not locally inspectable; client/hintsTask6, UI7-8 and permissioncutover10 are pending explicit scopes.
Task 5: complete (commits6e1d50c..00fc91d, independent Sol medium review speccompliant/Approved, nofindings; report55DB/TSC passing).
Ruling: Allow minimal existing contribution-test fixture/expectation updates inTask6 when replacing tagged funding reader - old tests assume tags increase saved money, which contradicts the approved reservation model - retain modal association/reset/cancel/installment coverage and defer new release UI tests toTask8; explain any moved assertion inreport.
Task6 implementing; base07bcbbd; task_6_transport (Luna high), typed client/user-scoped snapshots/refresh; no additional SQL work authorized inTask6.
Ruling: Read history NUMERIC deltas with explicit reserved_delta::text/spent_delta::text selection, then normalize valid signed decimal text to canonical two places before AllocationEventSchema - raw JSON numbers violate exact-money history boundaries - avoids unnecessary new history RPC/migration; reject invalid values instead of coercing them. PostgREST official casting docs support this (https://docs.postgrest.org/en/stable/references/api/tables_views.html#casting-columns), and native loopback probe verified both deltas arrive as strings with exact2000.25. Numeric zero may return text0, so normalize exact text without floating arithmetic.
Task6 independent review atf659cd2 requests fixes: Important auth/session race can populate old user key with newer-session snapshot; Important projection early branch uses display-number arithmetic. NoCritical/Minor findings.
Controller confirmed additional Task6 acceptance gap in installed SWR source: revalidation catches fetch failure and resolves, so a mock mutate rejection does not prove real saved-but-refresh-failed reporting. Fix must include real mounted-hook fetch failure evidence and propagate cache refresh failure separately from committed write.
Task6 fix round1/5: resume Luna high implementer, address2review findings plus verified refresh-observability gap; source/tests/report only. NoTask7 dispatch until scoped review is clean.
Ruling: Task7 may minimally extend useGoals to expose its resolved userId, authoritative snapshot, and scoped refresh, and add an owner-scoped read-only wallet/history metadata adapter as needed - dialog interfaces accept only goalId/open and must resolve fresh amounts fromTask6, whose public hook requires a userId - avoid duplicating auth state or trusting caller balances; no extra SQL/runtime dependency or unrelated redesign.
Task6 fix round1/5 complete: d4dbe29 addresses2independent Important findings plus real SWR refresh-observability gap. Fresh scoped Luna high review all3ADDRESSED/no newbreakage; full63Vitest+2Node andTSCpassing.
Task 6: complete (commits07bcbbd..d4dbe29, independent review and scoped fix review clean). Task7 dialogues must pass hook-scoped refresh to preserve saved-but-refresh-failed feedback; canonical financeAmounts remain source for calculations.
Task7 implementing; basebf0068f; fresh task_7_actions Luna high. Goal funds/completion/history UI, minimal shared reader extensions permitted by ruling; noSQL/live writes.
Local browser verification infrastructure ready: ignoredpreview-start/stop +preview-bootstrap(127.0.0.1:3108) +prepare-preview-session +prepare-preview-fixtures. Nextdev127.0.0.1:3107, localSDK55440. CUA tab1/browser2 (iab), goalPreviewTab/goalPreviewBrowser bindings, bootstrap http://localhost:3108/__local_preview_session reached http://localhost:3107/dashboard; read-onlyscreen showedemptyloadedDashboard. No finance/UIacceptanceflow claimed. Localfixtures3PHPwallets(GCash30000,Cash10000,creditdebt5000),4activeconfirmedgoals(Phone5000,Laptop30000,Date3000,debt5000),9ownedcategories, zeroallocation/transaction/operationrows. Allprivatecookies/JWTs/IDsconfigignored; neverprintvalues.
User asked whethertestlogin isproductionvulnerability; controllerverifiedhelperignoredbyGit, localhostbind, independentlocalDB/keys, productionmiddlewareauth.getUser retained. Explainlocalharnessloginisnotproductionbypass; temporaryidentitysignup isseparateaccesspolicy issue, cross-userdenialtestsTask10. Do not claimfullproductionaudit.
Userwalletclarification: GCashis onlytestexample, allownedactivePHPnoncreditwallets supportgoals includingGoTyme. UserexplicitlyexcludesPayLater fromreservedfunding/availablecash. Existingcredit/debtpaymentledger remains inTask8, notremoved. Localpreview nowalsoGoTymeSavings PHP20000 bankactive; seederidempotent4wallets/4goals/9categories/zerofinancerows; SQL003eligibilityverifiedreadonly. Task7worker instructedgenericwalletchoices + PayLaterexclusion.
UserlatencyfeedbackTask7: askedwhyLunahigh ratherthanxhigh/Sollow; controllerownsunderestimatedUIbreadth, no claimhigherreasoningisfaster. OfficialOpenAIdeploymentchecklistnoteslower effort generallylesslatency/reasoningtokens (https://developers.openai.com/api/docs/guides/deployment-checklist). Userthenpreferskeepcurrentworkerifchangingwouldriskbreakage; do notrestartTask7. Workerreportedfocused15/16, onewordingassertionmismatch, brief/rootconfirmedhistoryarchiveconditionsstillpendingthenfocused/TSC/fullsuite/reportcommit. FuturechooseSollowfornarrowUIpatches,Solmediumcomplexfinance/authstate,Lunamediumroutinehelpers/tests; noAstra andexistingeffortcapsretained. Nofullsessiondiagnostic/exportrequested; don'tspawnanexpensiveaudit.
Ruling: Task7 mayupdateexistingcontributions.test.tsx querylabelAddcontribution→Spendfromgoal - Task7 explicitlyrenamescardaction; oldUItestmustfollowrealaccessiblelabel whilepreservingshortcut/defaultgoal/reset/cancelbehavior - nofundingsemanticschangesorweakenedassertions. Workerfirstfullsuite79/80 label-onlyfailure, finalrerunjustified.
UseraskedLunahigh/xhigh: remainavailablewithinexistingLunamediumfloor; highforboundedcoordinatedwork, xhighfocuseddeepanalysiswhenworthadditionalreasoning, notautomatic. BroadcomplexfinancialstatemoreappropriatelySolmedium; noAstra. KeepcurrentTask7worker, noforcedmodelchange.
Task7 implementedata9167c4, reported17focused/80Vitest+2Node/TSCpassing. InitialSolmediumreviewneedsfixes:1Important falseemptycompletiononsnapshoterror +2Minor mobile44target/mandatedtestassertion gaps.
Ruling: UsefreshSol low forTask7narrowfixround1 ratherthanrestartLunahighUIimplementation - code iscommitted and reviewisolatesthreeboundeddefects, useraskedwhereSollowfits and retainscontrollerroutingjudgment - preserveexistingwork/scope, testandre-reviewpatchbeforecontinuing. No broadredesign/newmodelarchitecture.
Task7 fixround1 atf32f679: scopedLunamediumreviewapproved/all3addressed/no newbreakage. Fresh21focused/84Vitest+2Node/TSCpass.
Task 7: complete (commitsbf0068f..f32f679, independentreview+fixreviewclean). BrowserverificationTask11pending, transactionwriterTask8pending.
Usermodelpolicyupdate2026-10-07: whenLunaimplementscoding usemax; Lunamedium/highforlightertasks. Sol remainslow/mediummaximum; noAstra. Existingcompletedtasksnotredone. Controllerselectsmodelsbycomplexity/value.
Browserharnessremainingissue: CUA direct127.0.0.1:55440/auth/v1/user returnednet::ERR_BLOCKED_BY_CLIENT beforeHTTP; proxytraceonlySSRorigin-nullrequests. NotserverCORSevidence. Investigatelocalhostroute via documentedbrowserAPI, no securitybypass/productauthchanges. Temporarysafeproxyinstrumentationmayremain afterinterruption; restore viaownedhelper later.
Task8 implementing; base72591fb; freshSolmedium task_8_transactions forquote/confirmation/atomicwriter/deletion +unknownrequestrecovery. Samefinancialmodel/tests/review/no push restrictions.
Ruling: ExtendTask8 narrowlyto004transactionmigration/schema.sql andrealDBregressiontests forinformationalcreditexpensegoalassociation - bindingbriefallowscreditpurchaseassociationwithoutfunding butearlierSQL rejectsallcreditgoalId/emits spendforallnonnullgoalId - hidingfeaturewouldviolatespec; keepcreditexpenseownedactiveconfirmedtag only, noreserve/progress/spendevent, installmentsdebtonce, crossownerdenial/deletion/replayverified. Existingunappliedmigrationcorrectionallowed, no newliveDBmigration. SameTask8SolmediumworkerownsUI+patchserially, no secondparallelimplementation.
Localpreviewstack wasstoppedafterinterruption; infraLunamediumrestoredownedPG/PostgREST/proxy/Next/bootstrap, no productchanges. LocalHTTP200/CORS204, oldblockedbyclient stillneedsfreshbrowserprobe. Proxyalreadyoriginal(pre-debughashmatches), noinstrumentationrestore needed.
Ruling: Task8 may minimallyadd optional linkedTransactionIds toGoalHistoryEntry fromownedfinancial_operation.result validatedtransactionIds - automaticreleaseevents have transaction_idnull, detailneedsoperationassociation todistinguishreleasefromspend/carry - preserveoriginaleventIDs/schema and owner/authsessionvalidation, no inventedtransaction_id/API/SQLchange.
Browserfreshlocalhost55440probe afterservicesrestored stillERR_BLOCKED_BY_CLIENT beforeHTTP. Recordrenderedverificationlimitation, no securitypolicybypass; DBandUIunitcheckscontinue.
Ruling: ExtendTask8narrow005migration/schema repeatedapplicationfix - reapplying004then005leaves existingprivategoal_transaction_applyoldbody underconditionalrename - manualdisposable-onlyfunctioncopywouldhideactualmigrationdefect. Orderedfresh/repeatedschema mustrefreshtransactionhelpercorrectlywhile005standalonereapplydoesnotreplacehelperwithlifecycle dispatcher; addrealDBregression, nohiddenmanualpatch/livechanges. Workerownsserialfix andreviewmustcoverbothmigrations.

Task 8: complete (commits72591fb..605057d, independent Sol medium review spec compliant / Approved, no findings). Report:111 Vitest +2 Node,57 native DB tests,TSC exit0. Task11 browser/build acceptance remains pending.
User model clarification: Luna coding max; lighter work medium/high; Sol low/medium only; no Astra.

Task9 implementing; base2c6e47c; task_9_wallet_summaries Luna max per latest coding policy. Own listed reader/UI files and rollout debt audit; no parallel implementer.
Controller fresh CUA localDashboard repro: initial skeleton then failed Supabase auth fetch renders falsezero headline/metrics; sent Task9 reader-error evidence. Five local listeners healthy; no browser-security bypass. Task11 loaded rendered acceptance remains pending.

Ruling: Task9 may minimally update tests/contributions.test.tsx account/mock snapshot fixtures - existing useAccounts mock creates newinline data array eachrender and causes infinite mounted Accounts effect; real SWR keeps stabledata - use stable completePHPactive accountfixture and consistent snapshotwallets/mutate as needed; preserve every behaviorassertion, no weakening/runtime changes. Worker owns serialfix and report.

Task9 implementedcb92691; independentSol low review Needs fixes:1Important overlappingloadAccounts stale-responsewrites,1Minor captioninclusion scope. Fixround1 freshSol low boundedrace/captionpatch; noTask10dispatchuntilreviewclean.

Task9 fixround1 at95d941d; re-review addressesrace/caption butmanualreload-after-queryerror lacksunconditionalunmountinvalidation. Fixround2 sameSol low narrowfixer; Task10notdispatched.

Task9 fixround2 at85747d4; independentSol low re-reviewApproved/allfindingsclosed. Task9 complete (2c6e47c..85747d4),123Vitest+2Node/TSC/12focused. Live debtinventory remains documenteddeploymentpreflight; renderedloadedTask11gatepending.
