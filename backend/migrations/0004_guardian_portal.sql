CREATE TABLE `guardian_link` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_user_id` text NOT NULL,
	`guardian_user_id` text NOT NULL,
	`relationship` text NOT NULL,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`invited_at` integer,
	`accepted_at` integer,
	FOREIGN KEY (`applicant_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`guardian_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardian_link_applicant_idx` ON `guardian_link` (`applicant_user_id`);--> statement-breakpoint
CREATE INDEX `guardian_link_guardian_idx` ON `guardian_link` (`guardian_user_id`);--> statement-breakpoint
ALTER TABLE `application` ADD `guardian_submitted_at` integer;--> statement-breakpoint
ALTER TABLE `application_file` ADD `uploaded_by_user_id` text REFERENCES user(id);--> statement-breakpoint
ALTER TABLE `magic_link_token` ADD `purpose` text DEFAULT 'applicant_signin' NOT NULL;