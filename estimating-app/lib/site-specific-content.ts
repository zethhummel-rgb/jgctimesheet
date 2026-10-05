import type { SafetyPage } from './site-specific';

// Adapted from the JGC site-specific DOCX, the supplied 20-page framework,
// and the JGC policy in the supplied combined package. See docs/site-specific-content.md.
// Site addresses, assigned people, hospital routes and client conditions are deliberately blank.
type Entry = readonly [label: string, value: string];
const section = (id: string, title: string, entries: Entry[], included = true): SafetyPage => ({
  id, kind: 'section', title, included,
  fields: entries.map(([label, value], index) => ({id: `${id}-${index}`, label, value, multiline: true})),
});

const responsibilities = `JGC project manager: implement the project health and safety program; review responsibilities with the supervisor and subcontractors; coordinate site access, traffic, storage, public protection and emergency arrangements; review safe work procedures and required training.
Site supervisor: orient workers before they begin, review each task and its hazards with the workers, maintain tools and safety equipment, correct unsafe conditions, arrange daily housekeeping and report incidents to the project manager.
Subcontractors: coordinate activities through the site supervisor, provide competent workers and appropriate training/PPE, supply required safety documentation, report hazards and incidents and clean their work areas daily.
Workers: follow the site plan and task instructions, use the required protection, inspect equipment before use and report unsafe conditions immediately.`;
const orientation = `Before starting work, review the scope and work areas, site access rules, current JSA, foreseeable hazards and controls, emergency contacts, first aid arrangements, evacuation routes and muster point.
Hold daily safety briefings and task-specific toolbox talks. Review changes in conditions, work sequence, equipment, materials and nearby activities with affected workers and subcontractors. Record attendance and acknowledgements.`;
const communication = `Use two-way communication and mobile phones to contact the site supervisor, project manager and client/site representative. Confirm the contact list and how workers will summon assistance before work begins.
Coordinate work, deliveries, access during and outside normal hours, service interruptions and disruptive activities with the client and affected trades. Keep facility personnel informed of work that may affect their safety or access.`;
const evacuation = `1. Stop work, leave the immediate danger area and alert others when safe. Activate the site alarm if available; close doors behind you when safe.
2. From a safe location, call 911 for an emergency. Give the current site address, exact location, nature of the emergency and any known hazards. Arrange for someone to direct emergency responders without entering danger.
3. Use the nearest safe exit; take an alternate route if smoke or another hazard blocks it. Do not re-enter until authorized by emergency responders or the responsible site representative.
4. Go to the designated muster point for a headcount. Keep exits and emergency access clear. Report missing people to responders; do not attempt an unplanned rescue.
5. Attempt to use an extinguisher only if trained, the fire is small, the alarm has been raised and a safe escape route remains available. Otherwise evacuate.
6. If trapped, call 911 and give your exact location.`;
const housekeeping = `Keep work areas, walkways, stairs, exits and emergency access clear. Remove debris as work progresses and clean each work area at least daily.
Use the approved waste collection locations and disposal routes. Segregate hazardous waste and arrange disposal through the appropriate approved service; do not mix it with general construction waste.
Store materials securely to prevent tipping or collapse. Keep hazardous products labelled and stored according to the current SDS and manufacturer instructions. Coordinate delivery quantities, storage areas and disposal with the client.`;
const dust = `Review the work methods and available designated-substance information before disturbing existing materials. Stop and consult the supervisor if suspect hazardous material is encountered; arrange assessment and qualified specialist work where required.
Use low-dust methods, suitable wet controls or tool shrouds with HEPA dust extraction at the source. Plan wet methods to avoid electrical, slip and water-damage hazards.
Separate dusty work from occupied areas using suitable barriers, signs and controlled access. Coordinate ventilation/HVAC protection with the client; provide a task-specific exposure control plan where required.
Select respiratory protection for the assessed material and exposure. Provide the required fit testing, training and maintenance; do not assume one mask is suitable for every task.`;
const fire = `Keep exits and access to firefighting equipment clear. Remove unnecessary combustible material, manage ignition sources and maintain appropriate accessible extinguishers for the assessed hazards. Workers must know the alarm procedure and extinguisher locations.
Store flammable products and gas cylinders safely according to the site storage plan, SDS and applicable requirements. Use suitable shielding around hot work. Inspect for fire hazards and report deficiencies before starting.`;
const hotWork = `Confirm whether the client/site requires a hot work permit for welding, cutting, grinding or other ignition-producing work. Obtain authorization before starting.
Review nearby combustibles, hidden spaces and adjoining areas. Remove or protect combustible material, provide suitable shielding and firefighting equipment and assign trained fire-watch personnel when required.
Follow the permit's controls, monitoring and post-work watch requirements. Record the permit, responsible person, fire-watch arrangements and site-specific monitoring period.`;
const sds = `Obtain the current supplier SDS before a hazardous product is brought to or used on site. The supervisor reviews handling, storage, exposure controls, PPE, first aid, fire and spill information with the affected workers.
Keep SDS information readily accessible in the site safety binder/Job Board or another agreed location. Tell workers where it is and how to access it during orientation.
Subcontractors provide SDS information for products they introduce and receive information about hazardous substances already present. Maintain product labels and provide WHMIS and task-specific training.
Review the information when products or hazards change and replace superseded copies.`;
const lockout = `1. Notify affected workers and the client/site representative. Identify the equipment and all electrical, mechanical, hydraulic, pneumatic, thermal and other energy sources; review the approved site-specific isolation procedure.
2. Shut down using the normal procedure, then isolate every energy source. An operating switch or push button alone is not an isolation device.
3. Authorized workers apply their personal locks and identification tags using the approved procedure. Consult the supervisor if the equipment cannot be securely isolated.
4. Release, discharge, restrain or block stored energy and prevent it from accumulating again.
5. Verify isolation and the safe zero-energy condition before work begins. Electrical verification/testing is performed by a qualified person using appropriate equipment and precautions.
6. Complete the work under the isolation. Follow the approved group-lockout and shift-change arrangements where applicable.
7. Before restoring energy, inspect the work, reinstall safeguards, clear people and tools and obtain the required supervisor/client authorization. Each worker removes their own lock under the approved procedure.
8. Notify affected people, restore energy in a controlled manner and confirm safe operation.`;

export function standardSafetyPages(): SafetyPage[] {
  return [
    section('scope', 'Project location and scope', [
      ['Scope of work', ''], ['Work areas and access', ''], ['Schedule and working hours', ''], ['Site-specific requirements', ''],
    ]),
    section('contacts', 'Client and contractor contacts', [
      ['Client / site contact and phone', ''], ['JGC project manager and phone', ''], ['Site supervisor and phone', ''],
      ['First aid personnel and phone', ''], ['Subcontractor contacts', ''],
    ]),
    section('roles', 'Roles and communication', [
      ['Site responsibilities', responsibilities], ['Orientation and daily safety briefings', orientation],
      ['Reporting hazards and incidents', 'Report hazards, injuries, property damage and near misses to the site supervisor immediately. Stop or isolate unsafe work when safe to do so; protect others from the hazard. The supervisor arranges the response, records the event and notifies the project manager and client under the applicable reporting procedure. Review corrective actions with affected workers before work resumes.'],
      ['Communication with client and contractors', communication],
    ]),
    section('hazards', 'Site hazard assessment', [
      ['Activities and site hazards', ''],
      ['Risk assessment', 'Review each planned task with the workers before starting. Identify who may be exposed, including subcontractors, occupants and the public; assess the likelihood and severity of harm and record the controls in the site assessment/JSA. Reassess when the work or site conditions change.'],
      ['Control measures', 'Eliminate the hazard where possible; otherwise use appropriate engineering and work-area controls, safe work procedures and required PPE. Keep public/occupied areas separated from the work. Provide accessible first aid supplies, eyewash where required and suitable fire protection. Inspect controls and equipment before use and maintain a clean work area.'],
      ['Required training and permits', 'Confirm worker competency, training and equipment inspection requirements for the planned tasks. Review required client/site permits, utility locates and isolation procedures before affected work begins. Keep applicable JSAs, permits, training records and inspections with the site safety documentation.'],
    ]),
    section('ppe', 'Personal protective equipment', [
      ['Required site PPE', 'Use safety footwear, head protection and eye protection appropriate to the site hazards and site rules. Wear suitable work clothing and gloves for the task. Inspect PPE before use and replace damaged or unsuitable equipment.'],
      ['Additional PPE by activity', 'Assess each task for additional face, hearing, respiratory, high-visibility and fall protection. Select equipment for the assessed hazard and applicable requirements; provide the required training, fit testing and inspections. Confirm task-specific PPE in the JSA and site instructions before work starts.'],
    ]),
    section('emergency', 'Emergency response and evacuation', [
      ['Emergency phone number', '911'], ['Nearest hospital and address', ''],
      ['First aid supplies and equipment', 'Provide readily accessible first aid supplies and any required eyewash or other emergency equipment. Identify trained first aid personnel, inspect supplies and tell workers where to find assistance during orientation. Record the actual kit/equipment locations and personnel for this site.'],
      ['Fire response and evacuation procedure', evacuation], ['Muster point and site access for emergency services', ''],
      ['Directions to nearest hospital', ''],
    ]),
    section('logistics', 'Site layout and traffic', [
      ['Site layout and access routes', ''],
      ['Public and vehicle separation', 'Separate work areas from occupants and the public using appropriate barriers and signs. Maintain safe pedestrian routes and emergency exits. Coordinate vehicle movements and use trained traffic control/spotters where the assessment requires them.'],
      ['Deliveries, storage and pedestrian controls', 'Agree delivery times, unloading and storage areas with the client and site supervisor. Keep access routes clear, store materials securely and protect nearby workers and pedestrians during handling. Confirm any work outside normal hours before arranging access.'],
    ]),
    section('noise', 'Noise and vibration', [
      ['Noise / vibration sources', ''],
      ['Exposure controls and communication', 'Identify noise and vibration from the planned tools and equipment. Use suitable lower-noise methods, maintained equipment, isolation and work scheduling to reduce exposure. Assess hearing protection and other controls for the task. Coordinate disruptive work with the client and notify affected workers/occupants before starting.'],
    ], false),
    section('dust', 'Dust management', [
      ['Dust-generating activities', ''], ['Containment and exposure controls', dust],
      ['Housekeeping and monitoring', 'Clean dust using suitable HEPA vacuuming or wet methods. Do not dry sweep or use compressed air to clean silica dust. Check dust extraction, barriers and housekeeping during the work; reassess controls and monitoring if conditions change or dust escapes the work area.'],
    ], false),
    section('locates', 'Locates and utilities', [
      ['Services / utility locations', ''],
      ['Locate records and isolation procedures', 'Obtain and review applicable utility locates, drawings and scanning before work that could disturb buried or embedded services. Confirm the work area and validity/limits of the records with the responsible parties. Use the approved isolation/lockout procedure where services must be shut down and record authorizations before proceeding. Stop work if an unidentified service or discrepancy is found.'],
    ], false),
    section('waste', 'Waste and environmental controls', [
      ['Waste handling and disposal', housekeeping],
      ['Spill prevention and response', 'Plan storage and handling to prevent releases. Keep appropriate spill supplies available and review the product SDS and site spill response procedure. Stop the source only if safe, isolate the affected area and notify the supervisor/client. Use trained personnel and the required controls for cleanup; arrange appropriate disposal and reporting.'],
    ]),
    section('fire', 'Fire prevention and hot work', [
      ['Fire prevention measures', fire], ['Hot work permits and fire watch', hotWork],
    ]),
    section('sds', 'Safety data sheets', [
      ['Products and hazardous materials', ''], ['SDS locations and handling controls', sds],
    ]),
  ];
}

export const standardProcedureChoices = [
  {id: 'lockout', title: 'Lockout and tagout'},
  {id: 'dust', title: 'Dust and silica controls'},
  {id: 'fire', title: 'Fire prevention and hot work'},
  {id: 'housekeeping', title: 'Housekeeping and material storage'},
  {id: 'sds', title: 'Hazardous products and SDS'},
  {id: 'evacuation', title: 'Emergency response and evacuation'},
] as const;
const procedureValues: Record<string, {steps: string; hazards: string; controls: string; ppe: string}> = {
  lockout: {steps: lockout, hazards: 'Unexpected startup, electric shock, moving equipment and release of stored energy.', controls: 'Use the approved equipment/site isolation procedure and competent authorized workers. Identify every energy source, apply personal locks/tags and verify the safe isolated condition before work. Review group lockout, shift changes and restoration with the supervisor.', ppe: 'Approved isolation devices, personal locks/tags and suitable verification equipment. Confirm qualified personnel and task-specific electrical/other protection before starting.'},
  dust: {steps: dust, hazards: 'Airborne dust, silica and possible designated substances; exposure of workers and nearby occupants.', controls: 'Use source capture, suitable wet methods, isolation and controlled access. Clean using HEPA vacuuming or wet methods; do not dry sweep or use compressed air for silica dust. Check controls during work.', ppe: 'Select respiratory, eye and other protection for the assessed material/exposure. Provide fit testing, training and qualified specialist assessment/work where required.'},
  fire: {steps: hotWork, hazards: 'Ignition of nearby or concealed combustibles, sparks, heat, smoke and burns.', controls: fire, ppe: 'Authorized hot work permit where required, appropriate extinguishers/shields and trained fire-watch personnel. Confirm welding/cutting protection and permit monitoring requirements.'},
  housekeeping: {steps: housekeeping, hazards: 'Trips, blocked exits, falling or unstable material, fire load and unsafe waste handling.', controls: 'Assign cleanup responsibilities, inspect work/storage areas regularly and correct hazards as they arise. Use designated disposal routes and storage areas; keep emergency access clear.', ppe: 'Suitable gloves, footwear and handling equipment. Review lifting/handling methods and hazardous-product/waste requirements with workers.'},
  sds: {steps: sds, hazards: 'Exposure, incompatible storage, spills and incorrect first aid or firefighting response.', controls: 'Confirm the product inventory, current SDS, labels and accessible SDS location. Review safe handling with workers before use and provide updated information when products or hazards change.', ppe: 'WHMIS and product/task-specific training. Select protection, ventilation, spill and first aid equipment from the assessed hazards and current SDS.'},
  evacuation: {steps: evacuation, hazards: 'Fire, medical emergencies, hazardous releases, severe weather or another condition requiring evacuation.', controls: 'Confirm the site address, emergency contacts, routes, muster point, first aid and responder access. Explain the arrangements at orientation, keep routes clear and arrange a headcount.', ppe: 'Identified trained first aid personnel, accessible first aid supplies and effective communication. Emergency response equipment/training appropriate to the assessed site hazards.'},
};

export function standardProcedure(id: string): Omit<SafetyPage, 'id'> | undefined {
  const choice = standardProcedureChoices.find(p => p.id === id), values = procedureValues[id];
  if (!choice || !values) return;
  return {kind: 'procedure', title: choice.title, included: true, fields: [
    ['Task / activity', choice.title], ['Work steps or procedure', values.steps], ['Hazards and risks', values.hazards],
    ['Controls and safe work measures', values.controls], ['PPE, equipment and training', values.ppe], ['Person responsible / review', ''],
  ].map(([label, value], index) => ({id: `field-${index}`, label, value, multiline: true}))};
}
