CREATE TABLE `offer` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`course_key` text,
	`section` text,
	`cohort` text,
	`problem_session` text,
	`office_hours` text,
	`aid_amount_cents` integer DEFAULT 0 NOT NULL,
	`amount_due_cents` integer DEFAULT 0 NOT NULL,
	`enrollment_deadline` text,
	`notes` text,
	`response` text,
	`responded_at` integer,
	`responded_by_user_id` text,
	`notified_at` integer,
	`last_import_id` text,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`responded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `offer_application_idx` ON `offer` (`application_id`);--> statement-breakpoint
CREATE TABLE `offer_import` (
	`id` text PRIMARY KEY NOT NULL,
	`imported_by_user_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_hash` text NOT NULL,
	`row_count` integer NOT NULL,
	`changed_count` integer NOT NULL,
	`changed_app_ids` text NOT NULL,
	`diff_json` text NOT NULL,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`notified_at` integer,
	`notified_count` integer,
	FOREIGN KEY (`imported_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `payment` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`stripe_checkout_session_id` text NOT NULL,
	`stripe_payment_intent_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'usd' NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`created_by_user_id` text,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`paid_at` integer,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_stripe_checkout_session_id_unique` ON `payment` (`stripe_checkout_session_id`);--> statement-breakpoint
CREATE INDEX `payment_app_idx` ON `payment` (`application_id`);--> statement-breakpoint
CREATE TABLE `stripe_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`received_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`handled_at` integer,
	`handler_result` text
);
