CREATE TABLE `section` (
	`id` text PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`course_key` text NOT NULL,
	`number` integer NOT NULL,
	`label` text NOT NULL,
	`problem_weekday` integer,
	`problem_minute` integer,
	`office_weekday` integer,
	`office_minute` integer,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `section_term_label_idx` ON `section` (`term`,`label`);--> statement-breakpoint
CREATE TABLE `session_occurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`section_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`starts_at` integer NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`zoom_meeting_uuid` text,
	`attendance_pulled_at` integer,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`section_id`) REFERENCES `section`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `occurrence_unique_idx` ON `session_occurrence` (`section_id`,`kind`,`date`);--> statement-breakpoint
CREATE INDEX `occurrence_date_idx` ON `session_occurrence` (`date`);