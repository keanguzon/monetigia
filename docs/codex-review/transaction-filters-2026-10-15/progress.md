# SDD ledger — plan: docs/superpowers/plans/2026-10-15-transaction-filters-and-sorting.md

User approved annotated full filter upgrade October15; asks minimal/no narration. Antislop during explicit session override retained. Sol6.1 low/medium for scoped tasks, Luna unavailable quota lasttask -> Sol low fallback mechanical work. Base0f29120 beta-1.1 (origin/main already same). No push/deploy/new productionSQL authorization. Preserve untracked audit_report_gemini.md and chat-export-2026-10-14.md. Working currentbeta: prior native isolatedworktree sandboxdenied, skillfallback already established; do not repeat inaccessible worktreecreation. Plan itself contains approveddesign/spec, no separate reachable spec.

Ruling: user go approves self-contained plan; replace stale draft status. Workcurrentbeta per established sandboxfallback. Commit approvedplan with targetedallowlist, neverblanketunignore. Cost: docscommit and workinexistingbranch, unrelatedfiles remain untouched.

## Preflight task self-consistency
|Task|Checks and ruling|
|1|Contract must settle RPCwire vs UI shape; preserve oldsort consumers untilTask5; version1,page50,arraycap100,search120,offsetmax1000000.|
|2|Same-row AND, ORwithinfield; totalgroupamount completechildren separate matchingids; ownerjoins all relateddata. Hydrationafterpage; aggregatesbeforepage; no mutabledebt snapshot sorting.|
|3|RPCorder authoritative, olddetail/proof path retained; debounce staleguard instant; unmount/owner errors distinct.|
|4|Draft vs appliedfilters distinct; Clearall global vs localdraft must beexplicit callbacks; custom date exclusive withpreset, amountPHP onlydisclosure.|
|5|Keep correction refreshreceipt/retry semantics and proofchecks; use matchingids forbulkselection butmanualsiblingselect allowed; custom hidespreset summary.|
|6|LocalQAonly, physicalPWA andcatalogmigrationmanual gate; no implicit productionwriting.|

## Shared interfaces and overlaps
|Tasks|Producer → consumer|Decision|
|1→2,3,4,5|HistoryQuery/wire/date union|Task1 fixes exactschema; no consumers changed untilintegration.|
|2→3|RPC version1+entryenvelopes|stringmoney, completehydratedrows, matchingRowIds, totals, exclusions; runtimevalidate.|
|3→5|useTransactionHistory orderedentries/page refresh|Singlequeryfingerprint ownergeneration; replaces pagestate; retaindetailproofloads.|
|4→5|Dialog/chips/sort/period API|Purecontrolledcomponents, backendoptionrequests parentcontroller, no duplicatedfilter logic.|
|2,5|groupmatching andbulkcorrection|Allchildrenvisible, selectall matchingeligibleonly; explicitmanual allowed.|
|3,5|history.ts+pagestate|Sequentialtasks no sharedfile parallel mutations.|
|4,5|PeriodBar andSummary|customdisplay/summaryhide, concise activehint only.|
|1–5→6|testcontracts/build/QA|FocusedREDGREENperunit thenintegrationfullsuite; no concurrentbuild/UItest.|

Ruling: query normalized wire version1 with sort,type,search,walletIds,categoryIds,includeUncategorized,minAmount,maxAmount,start,end,offset. UI dateunion lives outsidewire; absentbounds null. categoryIds empty+uncategorizedfalse meansno categorypredicate. Perarraymax100, search120Unicodecodepoints, offset0..1000000, money0..9999999999999.99; sameconstraints serverclient. Costifwrong: boundedqueries need laterpagination ofoptions.
Ruling: amountmodePHP eligibility source+destination fortransfer; group allchildsourcecurrenciesPHP. Unknown/inconsistentmetadata ornegative/nonfiniteamount excludedfromamountmode only; countspre-amountbounds afterotherfilters, disjointforeigntheninvalid. No currencyconversions. Group amount sumcan exceedindividualnumeric15,2; return exactstring safeBigInt formatting (boundinputstill15,2). Costifwrong: foreignamountsorting intentionallynotavailable.
Ruling: existing selectedgroup detailedloads getproofafterread; RPChydration doesnotassertdescriptionProof. Datesort group purchaseDateifconsistent/non-null else latestdue; creationmax createdAt thenmaxidtie. Need malformed groupdates markunknown/null last, not inventdates. Costifwrong: legacycorruptgroups show unavailablemetadata.

Task1 pending
Task2 pending
Task3 pending
Task4 pending
Task5 pending
Task6 pending
Task 1: complete —0f49aad. Sol low implementer/reviewer APPROVE task-1-review.md.28newquery+30existinghistory58focused,tsc. Baseline43history+page passed. Task2 base0f49aad. Disposablefilters_fixture created56839,REST56840/PostgREST56841;startupWindows descendantpipe andbootstrapquoting corrected inignoredharness only. Currentmigrationsinstalled. No production.
Task 2: complete —69d7669. Solmediumimplementer/reviewerAPPROVE task-2-review.md.10nativeDB+tsc;12000rowplans22msfiltered/79msall, noindexesneeded. Task3base69d7669. Legacyunavailabledateshydratednull, retainedinvalidamountstringsoutsideamountmode; adaptermusthonorunknown notinvent1970. Task2queryplanandreport preserved forQA later.
Task6earlyDBregression163tests:161pass2fail fromtestfixtureadminservice_role missingtablegrants ondebt_items/debt_due_rows, noSQLassertion/productfailure. Comparedhelpers adminfixture insertusage andoldmigrationdoesnotrevoke service_role onthese2tables, aligned disposableonly GRANTALL2tables (Supabase serviceadminseedingdefault). Noauthfunctiongrants/globalgrantweakening orprodchanges. FullDBrerunafterfixturealignmentinprogress; originalfailurelogpreserved.
Task6DBintegration: full sequentialnativeDB rerun afterfixturealignment163passed0failed0skipped,211364ms. Includes allprior153+new10historyRPC, no productSQLchangedafterreview. Logfull-db.log; initialfixturepermissionsfailure retainedseparately. No productionaccess.
Task3 fixround1: scoped Solmedium review found canonical metadata accepts older creation pair/wrong equal-time tie ID/unrelated valid transaction date. Originalimplementer addressing with negative tests; no broad re-audit. Userreaffirmed Luna max forsmallcoding,Sol6.1low/mediumcomplex/review; next Task4 tryLunamax.
Task 3: complete —c6b3a9e plus f0d792c scopedcanonicalmetadatarepair. SolmediumrereviewAPPROVE task-3-rereview.md.62focusedtests+tsc+lint; owner/request/options contracts inreport. Task4basef0d792c, dispatchLunamax.
Task4fixround1: Sol lowreview found verbosemobilesorttrigger plusverbatimdateformatterduplication. Ruling: allow smallshared src/lib/transactions/history-format.ts formatter extraction (UIpurelogic) topreventdivergence; Task5mayreuseexactmoneyformatter there. Rootalsofoundnative titleprops duplicating existingcustomTooltips, explicituserpreviousglobaltooltiprequirement; removefromTask4ownedcontrols. Cost: onefocusedsharedmodule, no theme/globalchanges.
Task 4: complete —ba4e55a+b485e7e. Lunamaximplementer, Sol lowrereviewAPPROVE task-4-rereview.md;14focusedUItests+tsc+lint. Sharedhistory-format.ts forrangeoutput; mobileicononly/nativetooltipduplicatesremoved. Task5baseb485e7e.
Userexplicitoverride: Task5review changed fromSolmediumto gpt-6-astra low. Priorfilters_review5 interrupted; soleactive scopedreview filters_review5_astra. No parallelduplicatereview.
Userapprovedamendment: retiremulti-currencycompletely includingaccounts/user_preferences currencycolumns; staticPHPdisplay, no conversions/balancechanges. Currencycleanup beforefinishingTask5/6. Preserveimmutablehistoricalmigrationfiles/auditledgerpayloads. Productionmigrationpreparedonly, notauthorizedexecution. Do notsilentlyreinterpretnonPHPlegacydata: migrationpreflightrejectsnonPHP/null metadata requiringexplicitreview. CurrentuncommittedJPY/KRWtestfix supersededbyPHPonly; pencilinlinewrapper retained. Task5Astrareview onlyfindingnativefractiondisplay nowobsoletedbycleanup; reviewremainingintegrationpassed.
Task 5: complete —12d99ab integration plusf59d181ordinaryactions,593d435PHPdatabase,37eceebPHPfrontend; userPHPamendment supersedesforeignrules. Task5Astrareviewfinancialintegrationapproved; soleforeignfractionfindingobsoletewithstaticPHP. SeparateDBSol lowreviewAPPROVE. Rootgroupactionalignmentlater22focusedpass+DOM320/375sameYgap4targets44.
Task 6: complete —615Vitestpass4preexistingconditional skips+8Nodechecks;171nativeDBpass0skip (163historicalprePHP+8freshfinalruntime),tsc,productionbuildexit0withpreexistingwarnings. FinalSol lowreviewAPPROVE37eceeb. Browser:375/320actions4px/44targets,nohorizontaloverflow320/375/768/1280bothmodes,search>1000,combinedwallet/category/amount/customdatesfullsiblingsOutsidefilters,100logicalpagesunique,clearretainsamountsort,preset5930unchangedwalletfilter,Retry503recover,Escapefocusreturn,actualdescriptioneditremovesmatchpreserves5000wallet/5.25amount/Aug22date/category. Localcatalog11MATCH+columnsREMOVED. ProductionSQL/push/deploynotperformed. PhysicaliPhonePWAmanualgate retained. SourcefinalgroupCSS22testpassandbuildverified; onlyroutineevidencecleanupremains.
