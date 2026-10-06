# Site-specific plan standard content

Release 986 uses editable JGC standard wording in new plans and offers an explicit fill-blanks action for existing plans. Opening a saved plan does not migrate, replace or publish it. Existing values, titles, inclusion choices, ordering, attachments and publication metadata remain intact. New fields and missing standard sections are added only on request. Site-specific addresses, scope, schedules, hazards, assigned people, hospitals, directions and muster points require the actual job information.

Source material supplied by the user:

| Source | Reusable content used |
| --- | --- |
| Site Specific Health and Safety Plan.docx, sections 6–11 | Communication, contractor/subcontractor responsibilities, PPE, daily housekeeping, first aid/fire equipment and evacuation steps |
| Framework for Site Specific Safety Plan.pdf, pages 5–19 | Responsibilities, task-specific PPE, noise, dust controls, utilities, waste/storage, fire/hot work, lockout, SDS and emergency arrangements |
| SSSP – Urgent Restore of Water Damaged Materials – Rev1.pdf, pages 47–50, 65, 87, 89, 112, 116–117 | JGC project manager/supervisor/subcontractor responsibilities, isolation, fire prevention, housekeeping/storage, hazard communication and dust |

The content is adapted into editable fields and optional reusable procedure pages. Original documents, personal certificates and contact details are not committed. The sample DOCX contains inconsistent project identities; none of those project-specific details are treated as defaults. The complete current JGC policy remains selectable from Portal documents rather than replacing it with a static historical copy.

Historical sample wording is not copied as a universal rule where it depends on the task, regulation or current conditions. This includes COVID instructions, fixed fall/noise thresholds, generic respirator assumptions, asbestos classifications, fixed extinguisher/watch distances or periods, and a three-year SDS renewal rule. Current supplier SDS information, task-specific assessment and approved procedures are used instead. Cross-checks: [Ontario WHMIS legislation guide](https://www.ontario.ca/document/workplace-hazardous-materials-information-system-guide-legislation/whmis-legislation), [IHSA silica guidance](https://www.ihsa.ca/PDFs/Products/Id/V005.pdf), [IHSA electrical lockout guidance](https://ohsguide.ihsa.ca/en/topic/electrical_lockout).

The nearest-hospital map is a dedicated optional image in Emergency response and evacuation. The original is uploaded privately using the existing approved-administrator attachment service; the plan stores a document reference, not image bytes. It persists with the job and appears in the emergency section of the combined PDF when that section and map are included. It is never published separately by this upload action. Missing/unreadable maps abort export rather than silently producing an incomplete PDF. Existing source files and published revisions remain separate.


## Structured plan layout (release 987)

The standalone framework and the first 20 pages of the combined SSSP were visually reviewed, including the PPE grid, checkboxes, contact tables, procedure boxes, site map and hospital route. Their rendered plan pages are identical. The combined package's two-page JSA was also reviewed; complete selected JSAs, certificates and the current policy continue to be appended without rebuilding those originals.

| Sample section / pages | Builder input | PDF presentation |
| --- | --- | --- |
| Location and description, p3 | Repeatable floor/area/access rows and area/phase/work-step/trade rows | Separate numbered sections with work-area and scope tables |
| Contacts, p4 | Separate contractor, client/facility and subcontractor rows; role, name, phone, email | Three labelled contact tables |
| Responsibilities, p5 | Assigned role/name/responsibility rows; editable orientation, reporting and coordination notes | Responsibility table and clearly separated narrative blocks |
| PPE and equipment, p6 | Required / Task specific / Not required / Not assessed, with notes for each item; extinguisher type/rating/quantity/location | Three-column equipment grid with marked requirements and a separate extinguisher schedule |
| Noise, p7 | Applicability and equipment questions, source/location/control rows | Assessment and mitigation tables |
| Dust, p8-11 | Applicability, bypass, demolition, silica, designated substances and fire-watch questions; seven editable procedure steps; site arrangements | Assessment table, numbered procedures and site-specific arrangements |
| Locates/scanning, p12 | Applicability and scan/isolation questions, provider/report/date/limits/authorization rows, explanation when not applicable | Assessment and locate register tables |
| Site/logistics/traffic plan, p13 | Feature/marker and location legend; section image upload, title and caption | Legend table followed by each included map on a full page |
| Waste/storage, p14 | Waste stream, collection, route/frequency and disposal rows; material/location/control/responsible-person rows | Separate waste and material storage tables |
| Fire protection, p15 | Applicability, bypass, hot-work and fire-watch questions; permit/monitoring/equipment rows; editable procedure steps | Assessment, hot-work table and numbered procedure |
| Control measures, p16-17 | Task/hazard/required-action/responsible-person rows; isolation question; editable lockout steps | Task control table and numbered procedure |
| Controlled products/SDS, p18 | Product/supplier/use/SDS-location/control register and five management steps | Product register and numbered management procedure |
| Emergency response, p19-20 | Medical contacts/transport, qualified first aiders, equipment, foreseeable event/response rows, alarm/muster/evacuation and hospital route | Emergency information tables, evacuation procedure and full-page hospital map |

An optional additional hazard assessment remains available. New task/risk pages have task-hazard-control tables; new procedure pages have editable numbered steps. Tables and steps support adding, removing and reordering rows. Page inclusion/order, versioned reusable page copies and full supporting attachments remain available. Inputs use the Estimate Desk's theme tokens and stack into one column on phones.

### Saved data and publication

`SafetyPage` gains optional `blocks`, `layoutKey` and `illustrations` fields in the existing workspace JSON. No database schema, access policy or publication workflow changes are required. Opening an old plan does not write or migrate it. **Add structured sections** adds missing blocks/fields/pages only; existing values, titles, order, included flags, hospital map, attachments and published metadata remain unchanged. Original free-text fields remain visible and entered values are exported alongside the new structures; names and Yes/No answers are never guessed from old text. Blank assessments are omitted from PDF output; they are never interpreted as No or approved.

Section images use the existing approved-admin private attachment service. The original is stored separately and referenced in the plan; image data is not embedded in workspace JSON. Images are never automatically published by uploading. Missing/unreadable selected images stop export. Images print once inside their section, without a duplicate appendix, and are omitted when the image or section is excluded. Reusable page text and structured rows are deep-copied; images from a different job stay with that original job so a reused page cannot silently carry the wrong site's map.

PDF output has numbered sections, a wrapping contents list with actual page numbers, repeating table headings and wrapped/split long table rows and checklist details. Maps retain their aspect ratio and are never cropped. Existing legacy text-only plans still export; complete policy/certificate/JSA attachments keep their content, orientation and PDF page geometry.


## Document page editor (release 988)

The editor opens on the plan cover. Previous and Next move through every safety section, including excluded sections, and end at supporting documents. Each safety section has an Include this page checkbox above the document. Excluding a section changes only its inclusion flag; text, rows and images remain available when revisiting it.

The form is an editable JGC document with the PDF's letterhead, green table headings, section headings and white paper. Text expands as it is entered. Table cells, questions, PPE, procedure steps and field headings are editable in place. Phones use labelled table rows to keep input readable. Long sections reflow across printed pages when exported; Preview PDF shows the final pagination.

Text fields and tables can be added to the current page. Blocks, rows, questions and fields stay in the editor when their answers are cleared. More plan options contains new pages, optional procedure templates, page ordering, saved page copies and explicit upgrades for older plans. PDF preview, download, visibility and publication are together in PDF & publish.

This changes the editor only. Workspace data shapes, original attachments, access rules, publication methods and the PDF renderer are retained. Opening a saved plan does not migrate or write it.

## Empty entries and PDF output (release 989)

Blank entries stay available in the editor. Fields, table rows, assessment questions,
equipment requirements and procedure steps have no delete control; clear their
answers to leave them out of the PDF. Add controls and whole-section inclusion
remain available. Uploaded maps and photos use their inclusion checkbox.

PDF output omits blank fields, unanswered assessments, empty table columns/rows,
empty blocks and sections with no content. Default contact roles and site-map
legend prompts appear only once information is entered. Completed answers such
as No, Not applicable, Not required and 0 remain visible. Existing standard
procedure text remains content until it is cleared. Saved data is not changed by
export, and contents numbering reflects only the sections that actually appear.
