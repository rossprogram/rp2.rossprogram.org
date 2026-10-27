CREATE TABLE `survey_response` (
	`id` text PRIMARY KEY NOT NULL,
	`round` text NOT NULL,
	`application_id` text NOT NULL,
	`respondent_kind` text NOT NULL,
	`respondent_user_id` text NOT NULL,
	`answers` text NOT NULL,
	`submitted_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`respondent_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `survey_response_unique_idx` ON `survey_response` (`round`,`application_id`,`respondent_kind`);