import type { SafetyBlock, SafetyPage, SafetyTable } from './site-specific';

// Adapted from the user's Traffic Plan Rev 0 and Spill Plans Rev 1.
// Source files stay private; no source job identity, route or approval is copied.
// Project requirements below remain editable and are not universal legal limits.
export const sitePlanTemplateChoices = [
 {id:'traffic-control',title:'Traffic control plan'},
 {id:'spill-prevention',title:'Spill prevention plan'},
 {id:'spill-response',title:'Spill cleanup and response plan'},
] as const;
export type SitePlanTemplateId = typeof sitePlanTemplateChoices[number]['id'];

type Pair = [string,string];
const table=(id:string,title:string,columns:[string,string,number?][],values:Record<string,string>[]=[{}]):SafetyTable=>({
 type:'table',id,title,columns:columns.map(([id,label,weight])=>({id,label,weight})),
 rows:values.map((cells,i)=>({id:`${id}-${i}`,cells:Object.fromEntries(columns.map(([key])=>[key,cells[key]||'']))})),
});
const entries=(id:string,title:string,items:Pair[])=>table(id,title,[['detail','Detail',1.4],['entry','Site information',2.6]],items.map(([detail,entry])=>({detail,entry})));
const steps=(id:string,title:string,items:Pair[]):SafetyBlock=>({type:'steps',id,title,rows:items.map(([title,body],i)=>({id:`${id}-${i}`,title,body}))});
const checks=(id:string,title:string,labels:string[]):SafetyBlock=>({type:'questions',id,title,rows:labels.map((label,i)=>({id:`${id}-${i}`,label,options:['Yes','No','Not applicable'],value:'',notes:''}))});
const contacts=(id:string,roles:string[])=>table(id,'Plan contacts',[['role','Role',1.3],['name','Name / company',1.3],['phone','Phone',1],['email','Email / after-hours contact',1.5]],roles.map(role=>({role})));
const page=(id:SitePlanTemplateId,blocks:SafetyBlock[]):Omit<SafetyPage,'id'>=>({kind:'procedure',layoutKey:id,title:sitePlanTemplateChoices.find(p=>p.id===id)!.title,included:true,fields:[],blocks,illustrations:[]});

export function sitePlanTemplate(id:string):Omit<SafetyPage,'id'>|undefined {
 if(id==='traffic-control')return page(id,[
  entries('traffic-site','Site access and layout',[
   ['Work phase, activities and operating hours',''],['Site entrance, security check-in and escort',''],['Vehicle approach, exit and direction of travel',''],['Largest vehicle, turning area and overhead clearances',''],['Delivery windows, holding and unloading areas',''],['Pedestrian routes and controlled crossings',''],['Emergency entry and responder escort',''],['Muster point and alternate',''],['Job Board, washrooms and servicing access',''],['Site speed restriction',''],['Layout drawing reference and field verification date',''],
  ]),
  steps('traffic-movement','Access and pedestrian movement',[
   ['Confirm the route','Coordinate entry, exit, security and delivery arrangements with the client/site representative before the first delivery. Verify the actual route and legal direction of travel; do not assume a drawing establishes gate permissions, one-way circulation or an exit connection. Record the confirmed arrangement and attach a marked layout.'],
   ['Book and control deliveries','Book deliveries through the JGC superintendent. Confirm clearance, escort, arrival time, vehicle dimensions and unloading needs before dispatch. Drivers check in and wait only in an authorized area. Keep queues out of operating lanes, building exits, emergency routes and public roads. Delay dispatch if no safe waiting area is available.'],
   ['Turning and restricted movements','Confirm a forward exit and turning strategy for the actual vehicle before entry. Where the approach is constrained, permit only one controlled construction vehicle movement at a time and confirm conflicting traffic is held by authorized arrangements. Stop and revise the arrangement if the vehicle cannot leave safely. Do not reverse into uncontrolled live traffic or independently redirect public/facility traffic.'],
   ['Separate pedestrians','Establish and field-verify a continuous pedestrian route between the agreed entrance, Job Board, work area and washrooms. Protect it from unloading, excavations and equipment operating envelopes. Use suitable barriers where people could enter a hazard area; cones and tape are delineation, not impact protection. At crossings, stop vehicles and positively acknowledge the signaller before people pass.'],
   ['Keep emergency and amenity access clear','Maintain safe building exits, emergency access, muster points and washroom servicing routes. Keep the Job Board accessible without standing in a vehicle path. Coordinate and establish an authorized alternative before changing access.'],
  ]),
  steps('traffic-operations','Deliveries and equipment operations',[
   ['Operating rules','Move at walking pace in the controlled approach and manoeuvring area, or slower for conditions; observe any lower site restriction. Inspect mirrors, cameras, alarms, lights, brakes and steering. Use seat belts where fitted and avoid distractions. Keep people outside blind spots, swing radii, crush points and loading zones. Stop when visibility, communication, ground conditions or separation become inadequate.'],
   ['Reversing and signallers','Eliminate or minimize reversing. Use a competent dedicated signaller when the operator cannot adequately see the intended path or a person could be endangered. Agree signals and radio channel and designate a lead signaller. The signaller performs no other work, stays outside travel/crush zones and has an escape route. Stop immediately if contact is lost, instructions are unclear or someone enters the zone. Re-establish safe conditions before resuming. Post reversing warnings where reversing cannot be avoided.'],
   ['Hydro-vac and excavation, when used','Confirm the truck standing location, bearing, footprint, boom/hose reach and traffic clearance. Locate and protect utilities. Keep hoses within the protected zone; agree protection or closure before crossing a live route. Protect excavations and exposed services using the assessed method; do not assume edge setbacks or overhead clearances. Keep emergency access open and apply the spill prevention plan to fluids and slurry.'],
   ['Unloading and lifting','Confirm the unloading position, vehicle swept path, overhead obstructions and stable bearing before delivery. Stop conflicting movements, exclude people from the load path and secure loads before departure. If lifting or trailer placement is required, coordinate a separate delivery/lift method addressing equipment, outriggers, services, exclusion zones and access restrictions.'],
   ['Signs, barriers and public-way restrictions','Agree positions and the safe setup/removal sequence with the site representative. Confirm device quantities, sightlines, route widths and physical barrier needs in the field. Avoid confusing existing traffic signs. Inspect protection after movement, impact and adverse weather. Obtain applicable road-authority requirements, permits and a suitable traffic-control layout before public-way or lane restrictions. An equipment signaller is not automatically authorized to direct public traffic.'],
  ]),
  table('traffic-hazards','Traffic hazards and protective measures',[['hazard','Site hazard',1.4],['control','Required protection',2.6]],[
   {hazard:'Occupied facility / security',control:'Coordinate access and work windows; preserve security controls, agreed escorts and facility operations.'},
   {hazard:'Bends and limited sightlines',control:'Inspect the route, keep corners clear and use controlled release/signallers as assessed.'},
   {hazard:'People near moving vehicles',control:'Separate routes, control crossings and keep amenities outside manoeuvring areas.'},
   {hazard:'Building doors and work boundaries',control:'Protect hazardous work while preserving exits; coordinate interior and exterior operations.'},
   {hazard:'Reversing and loading',control:'Minimize reversing; maintain a dedicated signaller, communication and exclusion zone.'},
   {hazard:'Excavations and unsupported ground',control:'Verify bearing and edge protection; protect utilities from vehicle loading.'},
   {hazard:'Overhead services',control:'Verify locations and applicable approach restrictions; stop if clearance is uncertain.'},
   {hazard:'Mud, debris, rain, ice or darkness',control:'Maintain drainage, traction, housekeeping and lighting; suspend unsafe movements.'},
  ]),
  contacts('traffic-contacts',['JGC superintendent','Alternate / lead signaller','Client / site representative','Site security / emergency escort']),
  steps('traffic-response','Responsibilities and emergency response',[
   ['Assign and brief the team','The superintendent coordinates the daily layout, deliveries, competent signallers and inspections. Each employer briefs its workers and implements protection. Drivers follow the agreed route and signaller and stop for uncertainty. Workers and visitors use designated access. Test communications and agree the stop signal; anyone may give an emergency stop signal.'],
   ['Collision, near miss or blocked access','Stop construction movements and prevent a secondary collision while preserving responder access. Call 911 for injury, fire or immediate danger and give the current site address and confirmed entry. Arrange the site escort. Provide first aid only within training and safe access; isolate damaged equipment/services through competent personnel and follow the spill plan for a release. Notify the superintendent/client under the project reporting arrangements.'],
   ['Evacuation and restart','Use a safe route to the agreed muster point and account for personnel. Keep vehicles out of evacuation routes. Restart only after hazards are corrected, controls reinstated, affected people briefed and the superintendent authorizes resumption in coordination with the site representative. Remove obsolete signs before reopening safe routes.'],
  ]),
  entries('traffic-review','Daily implementation record',[
   ['Date / shift and work phase',''],['Superintendent / inspector',''],['Equipment and delivery window',''],['Project reporting deadlines / requirements',''],['Crew briefing / driver instruction reference',''],['Client / security coordination record',''],['Implementation authorization and date',''],
  ]),
  checks('traffic-checks','Daily traffic checks',[
   'Access, security and delivery arrangements confirmed','Entry, exit, turning and largest vehicle path verified','Authorized holding area available; no unsafe queueing','Pedestrian routes, crossings, exits and washrooms protected','Emergency route and muster point accessible','Equipment position, hoses, utilities and excavations protected','Signs and barriers installed; clearances verified','Competent signaller assigned; communication tested','Equipment inspected; reversing controls in place','Route clean, stable, lit and suitable for conditions','Contacts posted and crews / drivers briefed',
  ]),
  table('traffic-actions','Traffic deficiencies and reinspection',[['issue','Deficiency / restriction',1.5],['action','Action and responsible person',2],['review','Reinspection / date / authorization',1.5]]),
 ]);
 if(id==='spill-prevention')return page(id,[
  entries('spill-site','Site spill prevention arrangements',[
   ['Activities, equipment and work areas',''],['Equipment standing / storage locations',''],['Drainage, catch basins, flow paths and sensitive areas',''],['Drain protection and containment locations',''],['Marked drainage / spill-kit plan and verification date',''],['Off-site refuelling supplier and arrangements',''],['Site SDS location',''],
  ]),
  entries('spill-requirements','Project spill requirements',[
   ['Refuelling rule','Off-site refuelling only. No on-site refuelling is permitted under this plan. Plan shifts, deliveries and fuel levels; remove equipment for refuelling. Stop if fuel is insufficient for safe work. Do not bring a bowser or portable refuelling supply onto the site.'],
   ['Spill-control capacity criterion','Required usable compatible resources: 110% of the largest possible spill to the environment. Confirm this criterion against the current project specifications and record the verified calculation below.'],
   ['Applicable project specification / additional restrictions',''],
  ]),
  steps('spill-prevention-steps','Spill prevention procedure',[
   ['Verify drainage and staging','Walk the site with the client/site representative before positioning equipment. Verify drains, flow paths, sensitive areas, staging and emergency access. A general site drawing is not a verified drainage map. Keep equipment and hoses within the agreed zone and protect building entries. Recheck after rain, snowmelt, grading or relocation.'],
   ['Protect parking and storage','Use sound authorized hard surfaces and compatible impermeable secondary containment/drip trays beneath leak-prone components and containers. Check paving and containment for cracks and routes to drains; hard surfacing alone does not contain a spill. Keep containers closed, upright, labelled, compatible and protected from impact/weather. Separate incompatible products and minimize quantities.'],
   ['Inspect equipment and isolate defects','Inspect equipment before daily use, after maintenance/relocation and abnormal events. Inspect storage after rain or snowmelt. Record defects, isolate leaking equipment and repair on an authorized protected surface. Verify leak-free operation before restart. Keep current SDS available.'],
   ['Hydro-vac checks, when used','Record the actual unit, fuel, hydraulic/auxiliary fluids, clean-water and debris/slurry tank capacities separately. Inspect tanks, pumps, PTO, hoses, couplings, valves, seals, rear door and discharge closures each shift. Check available debris capacity and level indication, monitor during work and stop before overfill or relocation.'],
   ['Hoses, connections and wash water','Secure lines against traffic, strain and abrasion, keep shutdown accessible and use drip trays at connections. Stop pumps and isolate pressure safely before disconnecting; cap lines and contain residues. Retain slurry and wash water for authorized removal; never discharge to pavement, soil, sewers, drains or water. Contain concrete washout separately.'],
   ['Unexpected contamination','Stop affected work if stained soil, unusual odours or suspect contamination are found. Isolate the material, notify the site representative and obtain qualified assessment under the project procedure. Keep suspect and clean loads separate.'],
   ['Training and readiness','Brief workers/subcontractors on leaks, shutdowns, kit locations, safe containment, reporting and emergency access. Record briefing attendance and practise the response arrangements before spill-risk work and when conditions change. Do not start until inventory, required capacity, contacts and drainage controls are verified and deficiencies resolved.'],
  ]),
  table('spill-inventory','Equipment and fluid inventory',[['unit','Owner / unit / model / location',1.4],['product','Product / system / SDS',1.4],['volume','Capacity / maximum on site (L)',1],['release','Largest release (L) / basis / connected systems',1.7],['control','Containment / shutdown / evidence / verifier',1.8]]),
  steps('spill-sizing-method','Spill resource sizing',[
   ['Determine the governing release','Record actual verified quantities for each unit and stored product. Include separate harmful-fluid systems and assess potentially contaminated water/slurry; do not automatically exclude a full debris load. Consider connected systems or simultaneous release. Use the maximum releasable inventory unless a documented physical limitation supports less. Unknown quantities remain unresolved.'],
   ['Demonstrate adequate resources','Apply the confirmed project capacity criterion to the governing release and retain manufacturer/supplier evidence. A storage bin volume is not its spill-control capacity. Count only compatible resources safely and immediately deployable for the same spill; do not double-count supplies. Provide suitable free-liquid/slurry recovery containers and transfer equipment. A future specialist call-out does not replace required on-site resources.'],
  ]),
  entries('spill-capacity','Spill capacity worksheet',[
   ['Governing equipment / system / release scenario',''],['Largest possible spill V (L) and evidence',''],['Required capacity factor / project reference',''],['Required usable capacity R (L) and calculation',''],['Available compatible capacity C (L) and ratings',''],['Adequacy confirmed (C at least R) / action if insufficient',''],['Verified by and date',''],
  ]),
  table('spill-kits','Spill kit register',[['kit','Kit ID / quantity',1],['location','Exact location',1.5],['contents','Compatible contents / recovery equipment',2],['capacity','Usable capacity (L) / rating evidence',1.3],['check','Condition / inspected by / date',1.4]]),
  steps('spill-kit-readiness','Kit contents and readiness',[
   ['Equip and maintain kits','Record pads, socks, booms, absorbent, drain covers, tools, compatible labelled recovery containers/bags, caution tape and SDS-selected PPE. Provide slurry recovery equipment when needed. Oil-only absorbents do not suit every water-miscible product. Keep kits visible, labelled, protected and immediately accessible. Inspect each shift and replenish after use.'],
  ]),
  entries('spill-inspection-details','Spill readiness and inspection record',[
   ['Date / time, inspector and unit / area',''],['Weather / ground conditions',''],['Response contact sheet / briefing reference',''],['Waste arrangements / carrier and receiver confirmation',''],['Superintendent readiness release / date',''],
  ]),
  checks('spill-daily-checks','Spill prevention daily checks',[
   'Fuel, oil, coolant, hydraulics and hoses checked','Hydro-vac tanks, valves, seals and levels checked where used','Circle check and shutdowns complete','Hard surface, drip trays and containment suitable','Containers labelled, closed and separated','Drainage and protective controls verified','Kits accessible, complete and adequate for confirmed inventory','Slurry and wash water contained','Refuelling follows the approved site rule','Waste secured and emergency routes clear','Contacts current and crew briefing complete',
  ]),
  table('spill-defects','Spill defects and reinspection',[['defect','Defect / isolation / restriction',1.5],['action','Correction / responsible person / due',2],['review','Reinspection result / inspector / date',1.5]]),
 ]);
 if(id==='spill-response')return page(id,[
  contacts('spill-response-contacts',['JGC superintendent','JGC alternate','Client project manager','Property / facility manager','Client health and safety representative','Client environmental representative','Site security / responder escort','Specialist spill contractor','Local municipality','Product owner / controller']),
  entries('spill-notification-requirements','Emergency and reporting arrangements',[
   ['Emergency services','911 for injury, fire or immediate danger. Give the current site address and confirmed access.'],
   ['Ontario Spills Action Centre phone','1-800-268-6060'],
   ['Client reporting requirement','Immediate verbal notification and a written report within 24 hours. Confirm the applicable project requirements, recipients and escalation route before work begins.'],
   ['Emergency entry / escort and after-hours arrangements',''],['Applicable specification / reporting requirements',''],
  ]),
  steps('spill-response-steps','Spill cleanup and response procedure',[
   ['Protect people','Stop work, raise the alarm and keep people and vehicles clear. Approach from a safe position, upwind/uphill where practicable. Call 911 for injury, fire, dangerous vapours or immediate threat. Preserve responder access and arrange the agreed site escort.'],
   ['Assess safely','Identify the product from labels/SDS without entering the spill. Assess fire, vapour, electrical, traffic and drainage hazards. Withdraw for unknown products, unsafe atmospheres or uncontrolled releases. Do not enter drains or confined spaces.'],
   ['Stop the source if safe','Only within training and safe conditions, stop pumps/engines and close valves. Do not handle pressurized leaks or attempt repairs during an uncontrolled release. For hydro-vac incidents, stop the operation, secure debris valves and prevent overfill.'],
   ['Notify immediately','Notify the superintendent/alternate and client using the confirmed arrangements. Make required calls to the Ontario Spills Action Centre, municipality, product owner/controller and other authorities. Assign a caller while safe containment begins; do not wait for a final quantity estimate or internal permission for an emergency call. Record unsuccessful calls and use the escalation route.'],
   ['Contain and protect','Where safe, place compatible socks, booms, berms, drain covers and recovery containers ahead of the spill. Protect drains, excavations and entries. Do not hose down, dilute or disperse with detergent.'],
   ['Recover and clean within capability','Trained workers may handle known controllable spills within their resources and SDS controls. Recover free liquid with suitable equipment, then absorb residues. Collect waste and PPE in compatible labelled closed containers. Request specialist help immediately when hazards or the release exceed crew training/resources.'],
   ['Document and close','Record times, quantities and uncertainties, photographs, contacts, instructions, effects, cleanup and waste records. Send available facts by the confirmed reporting deadline while cleanup continues and issue updates for outstanding results. Retain delivery evidence and record restart authorization.'],
  ]),
  steps('spill-escalation','Escalation, waste and reinstatement',[
   ['Escalate beyond crew capability','Request specialist response for unknown substances, fire/vapour hazards, threatened or affected drains/water, off-site migration, significant soil impact, tank/slurry failure or any spill beyond available training/resources. Do not assume a safe-volume threshold or enter unsafe areas for rescue/cleanup.'],
   ['Assess soil and drainage impacts','Report suspected drain entry; do not open or flush the system. Obtain specialist assessment and recovery. Segregate impacted soil on covered impermeable containment and obtain qualified sampling/excavation direction. Protect utilities and follow the project requirements for test review before backfill.'],
   ['Segregate and classify waste','Separate recovered product, absorbents, soil, slurry, wash water and PPE in compatible closed labelled containers on protected containment. Prevent runoff and rainwater entry. Do not dilute contamination or mix suspect and clean loads. Have a competent specialist determine classification, testing and facility acceptance, including separate assessment of dangerous-goods transport requirements.'],
   ['Track transport and disposal','Confirm the generator, applicable registration, authorized carrier/receiver and written acceptance before shipment. Complete required waste manifests and transport documents through the applicable systems; use qualified/trained personnel where required. Reconcile pickup, receipt, quantities and disposal tickets. Supply the client with required completed records and resolve discrepancies.'],
   ['Verify cleanup and authorize restart','Verify source isolation/repair, residual impacts, drainage protection, secure waste and replenished kits. Address specialist results and authority directions and coordinate client/consultant requirements before reinstatement. Record corrective actions and superintendent authorization. A clean-looking surface alone does not establish successful remediation.'],
  ]),
  entries('spill-incident','Spill incident report',[
   ['Report number / prepared by / role / callback',''],['Occurrence and discovery date / time',''],['Exact location / equipment / operator',''],['Product / SDS / owner / controller',''],['Estimated quantity (L) and estimation basis',''],['Ongoing release / duration / source / cause',''],['Weather / affected area / migration',''],['Soil / drain / water / building effects',''],['Injuries / exposure / evacuation / emergency response',''],['Photos / sketch / samples / attachments',''],['Uncertainty / further assessment needed',''],
  ]),
  table('spill-response-log','Response timeline',[['time','Date / time',1],['action','Shutdown / containment / recovery action',2.5],['person','Responsible person / evidence',1.5]]),
  table('spill-call-log','Notification log',[['recipient','Recipient / role',1.3],['time','Time / method / successful contact',1.4],['record','Contact name / reference / instructions',2.3]]),
  entries('spill-written-report','Written report tracking',[
   ['Written reporting deadline',''],['Sent date / time and recipients',''],['Delivery evidence and updates outstanding',''],
  ]),
  table('spill-waste-record','Waste tracking and disposal',[['waste','Waste / container / quantity / classification',1.7],['carrier','Generator / carrier / receiver / approvals',1.6],['record','Manifest / transport document / acceptance / receipt',1.7]]),
  entries('spill-closeout','Corrective action and closeout',[
   ['Root cause / investigation status',''],['Prevent recurrence / responsible person / due date',''],['Completion evidence / waste records delivered',''],['Residual impacts / monitoring / open actions',''],['Client / consultant / authority directions',''],['Verification by / date',''],['Restart authorization / date / time',''],['Final report issued by / date',''],
  ]),
  checks('spill-closeout-checks','Spill closeout checks',[
   'Source repaired or isolated and rechecked','Impacts assessed; results and authority directions addressed','Waste tracked to receipt and required records supplied','Kits replenished; inventory and sizing updated','Client / consultant coordination and required soil review complete','Crew rebriefed on revised controls',
  ]),
 ]);
}
