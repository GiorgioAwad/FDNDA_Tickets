-- Add weekly class frequency for events of category ACADEMIA.
-- Used to autocomplete `packageDaysCount` defaults in the ticket type creator.
ALTER TABLE "events" ADD COLUMN "academiaWeeklyFrequency" INTEGER;
