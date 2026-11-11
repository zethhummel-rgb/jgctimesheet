begin;

alter table private.shop_drawing_transmittals
  alter column reviewer drop not null,
  alter column review_status drop not null,
  alter column review_date drop not null,
  drop constraint shop_drawing_transmittals_check,
  add constraint shop_drawing_transmittals_stamped_pages_check check (
    cardinality(stamped_pages) <= page_count
    and array_position(stamped_pages, null) is null
    and 1 <= all(stamped_pages) and page_count >= all(stamped_pages)
  ),
  add constraint shop_drawing_transmittals_review_check check (
    (cardinality(stamped_pages) = 0 and reviewer is null and review_status is null and review_date is null)
    or (cardinality(stamped_pages) > 0 and reviewer is not null and review_status is not null and review_date is not null)
  );

commit;
