CREATE TABLE `applicant_profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`legal_name` text,
	`preferred_name` text,
	`dob` text,
	`grade_level` text,
	`school` text,
	`location` text,
	`timezone` text,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `application` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_user_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`submitted_at` integer,
	`decision_at` integer,
	`decision_by` text,
	`decision_notes` text,
	FOREIGN KEY (`applicant_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`decision_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `application_applicant_idx` ON `application` (`applicant_user_id`);--> statement-breakpoint
CREATE INDEX `application_status_idx` ON `application` (`status`);--> statement-breakpoint
CREATE TABLE `application_response` (
	`application_id` text NOT NULL,
	`question_key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	PRIMARY KEY(`application_id`, `question_key`),
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
