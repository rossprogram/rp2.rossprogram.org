CREATE TABLE `application_availability` (
	`application_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_min` integer NOT NULL,
	`end_min` integer NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `availability_app_idx` ON `application_availability` (`application_id`);--> statement-breakpoint
CREATE INDEX `availability_weekday_idx` ON `application_availability` (`weekday`);--> statement-breakpoint
CREATE TABLE `application_course_preference` (
	`application_id` text NOT NULL,
	`course_key` text NOT NULL,
	`rank` integer NOT NULL,
	PRIMARY KEY(`application_id`, `course_key`),
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_pref_rank_idx` ON `application_course_preference` (`application_id`,`rank`);--> statement-breakpoint
CREATE TABLE `application_file` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`kind` text NOT NULL,
	`storage_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`uploaded_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_app_kind_idx` ON `application_file` (`application_id`,`kind`);