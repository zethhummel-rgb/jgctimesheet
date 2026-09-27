-- Release 945: clean toolbox talk names, approved by Zeth on 2026-09-27.
-- The talks were named after their PDF files (underscores and dashes), and the defensive driving PDF carried
-- a confined-spaces name. Past toolbox talk reports and their attendee sign-offs take the new names too.
-- Only names change; the PDFs and their storage paths stay the same.
do $$
declare
  renamed integer;
begin
  update public.toolbox_talks t
  set title = n.title
  from (values
    ('asbestos-type-1-operations-low-risk.pdf', 'Asbestos Type 1 Operations (Low Risk)'),
    ('asbestos-type-2-operations-medium-risk.pdf', 'Asbestos Type 2 Operations (Medium Risk)'),
    ('asbestos-type-3-operations.pdf', 'Asbestos Type 3 Operations'),
    ('back_care_basic_manual-material-handling.pdf', 'Back Care: Basic Manual Material Handling'),
    ('backing_vehicles.pdf', 'Backing Vehicles'),
    ('chainsaws.pdf', 'Chainsaws'),
    ('confined_spaces_dangerous_atmospheres.pdf', 'Confined Spaces: Dangerous Atmospheres'),
    ('defensive_driving_highway_traffic.pdf', 'Defensive Driving: Highway Traffic'),
    ('confined_spaces_definition.pdf', 'Confined Spaces: Definition'),
    ('confined_spaces_physical_hazards.pdf', 'Confined Spaces: Physical Hazards'),
    ('driving_msds.pdf', 'Driving and MSDs'),
    ('drywall-installation-noise-exposure.pdf', 'Drywall Installation: Noise Exposure'),
    ('dust.pdf', 'Dust'),
    ('extension_ladders.pdf', 'Extension Ladders'),
    ('eye_protection.pdf', 'Eye Protection'),
    ('fall_protection_approvals_and_inspections.pdf', 'Fall Protection: Approvals and Inspections'),
    ('fire_extinguishers.pdf', 'Fire Extinguishers'),
    ('floor_and_roof_openings.pdf', 'Floor and Roof Openings'),
    ('formwork_placing_concrete.pdf', 'Formwork: Placing Concrete'),
    ('guardrails.pdf', 'Guardrails'),
    ('hand_protection.pdf', 'Hand Protection'),
    ('head_protection.pdf', 'Head Protection'),
    ('hearing_protection.pdf', 'Hearing Protection'),
    ('heat_stress.pdf', 'Heat Stress'),
    ('HEPA_filters.pdf', 'HEPA Filters'),
    ('impairment-at-the-workplace.pdf', 'Impairment at the Workplace'),
    ('3-point_contact_ladders.pdf', 'Ladders: 3 Points of Contact'),
    ('mobile_devices_on_worksites.pdf', 'Mobile Devices on Worksites'),
    ('mobile-devices-while-driving.pdf', 'Mobile Devices While Driving'),
    ('propane.pdf', 'Propane'),
    ('racial-discrimination-in-the-workplace.pdf', 'Racial Discrimination in the Workplace'),
    ('respirators_types.pdf', 'Respirator Types'),
    ('scaffolds_planks_and_decks.pdf', 'Scaffolds: Planks and Decks'),
    ('stepladders.pdf', 'Stepladders'),
    ('traffic_control_public_roads_1.pdf', 'Traffic Control on Public Roads (Part 1)'),
    ('traffic_control_public_roads_2.pdf', 'Traffic Control on Public Roads (Part 2)'),
    ('trenching_inspection.pdf', 'Trenching: Inspection'),
    ('trenching_protection.pdf', 'Trenching: Protection'),
    ('trenching_soil_types.pdf', 'Trenching: Soil Types'),
    ('underground_utilities.pdf', 'Underground Utilities'),
    ('winter_hazards.pdf', 'Winter Hazards'),
    ('workers_rights.pdf', 'Workers'' Rights'),
    ('working-alone.pdf', 'Working Alone'),
    ('working-at-heights-site-specific-training.pdf', 'Working at Heights: Site-Specific Training'),
    ('workplace_violence_and_harassment.pdf', 'Workplace Violence and Harassment')
  ) as n(file_name, title)
  where t.file_name = n.file_name;

  get diagnostics renamed = row_count;
  if renamed <> 45 then
    raise exception 'Expected to rename 45 toolbox talks but matched %.', renamed;
  end if;

  -- Past reports and their attendee sign-offs follow the talk they belong to (by id, not by the old name,
  -- because two talks shared one old name).
  update public.toolbox_talk_reports r
  set talk_title = t.title
  from public.toolbox_talks t
  where t.id = r.talk_id
    and r.talk_title is distinct from t.title;

  update public.safety_acknowledgements s
  set record_title = t.title
  from public.toolbox_talk_reports r
  join public.toolbox_talks t on t.id = r.talk_id
  where s.record_type = 'toolbox_talk'
    and s.record_id = r.id
    and s.record_title is distinct from t.title;
end $$;
