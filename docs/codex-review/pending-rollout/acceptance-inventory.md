# Pending rollout acceptance inventory

Checkpoint: 2026-10-08. This records implementation separately from review, deployment, and device acceptance. It is not a release-complete claim.

| Requirement | Implementation | Remaining evidence or work |
| --- | --- | --- |
| Five direct mobile destinations; Categories replaces More; Settings via profile | Implemented and reviewed on working branch | User QA and physical PWA/Safari acceptance |
| Home glyph for Dashboard, including desktop | Implemented | Desktop regression acceptance |
| Transparent capsule, neutral sliding selected pill, primary-green mobile icons and labels | User QA1 accepted dark; QA2 black light pill corrected to pale glass; root observed rgba(241,245,249,.48), green preserved, dark unchanged | Await user QA2 recheck. Primary green on a pale light surface is not normal-text contrast certified; text zoom and physical iOS acceptance remain |
| Mobile top progress indicator; no loading spinner on mobile nav glyph | Implemented | Integrated routing acceptance |
| Immediate requested highlight, skeleton, threshold, retained selection and refresh prompt | Implemented and reviewed | Automated latest-intent/threshold/recovery checks passed; actual slow/offline retry and financial-session reload acceptance remain |
| Mobile Transactions sort icon at far right of tabs row | Implemented and reviewed | Root observed mobile menu/Escape focus and desktop native select; enlarged-text/device QA remains |
| Archived Goals and Restore in Settings | Integrated as a61b0f1 | User reports migration success; authenticated production availability and frontend release remain unverified |
| Goal overspend separate Keep/Release popup | Brief ready; pending | Implementation, controller/focus regression and review |
| Opening debt with due date and integer remaining months, including 24 | Briefs ready; pending | Exact schedule, secured creation command, migration and UI |
| Settlement/correction, legacy debt adoption and Add Wallet fixed footer | Pending | Backend contracts and preserved-history checks before UI |
| Installment selection, select all, Shift range and full-row highlight | Pending | Reviewed correction command followed by scoped UI |
| Transaction/group title or description editing | Pending | Guarded metadata command and editor; no amount changes |
| Goals tab-return error | Recovery code on main | Actual production reproduction and acceptance still needed; unit tests cannot certify the reported symptom |
| Landing visual revamp | Draft saved as docs/superpowers/plans/2026-10-08-landing-visual-revamp.md | User review of plan before landing implementation |
| Integrated typecheck, lint and build for current mobile changes | Passed | 249 Vitest + 7 Node tests, explicit tsc, production build exit 0; five existing hook warnings remain. Current UI has not been newly deployed |
| Remaining financial rollout and final main deployment | Pending | Complete backend/UI tasks and migration prerequisites before claiming the entire plan or deployment complete |

QA will be presented one case at a time after a current status report. Existing user data must remain intact. Device-only checks and inaccessible browser checks must be stated explicitly rather than inferred from unit tests.

## Accepted mobile iteration (latest)

User accepted slow-network centered prompt, equal icon-only mobile slots, light theme, modal hide/restore and sort behavior. Latest request removes visible nav labels; accessible route names remain. Mobile changes are committed as 7c5b18a, not deployed. Fresh root full check:250Vitest+7Node passed; standaloneTypeScript/build exit0 (existingwarnings retained). These entries supersede earlier pending QA2 and visible-label inventory rows above. Physical Safari/device acceptance remains distinct. Task2 implementation now running; landing explicitly deferred.
