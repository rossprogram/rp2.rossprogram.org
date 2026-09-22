CREATE TABLE `agreement_signature` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`document` text NOT NULL,
	`signer_kind` text NOT NULL,
	`signer_user_id` text NOT NULL,
	`typed_name` text NOT NULL,
	`document_version` text NOT NULL,
	`document_hash` text NOT NULL,
	`signed_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`ip` text,
	`user_agent` text,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`signer_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agreement_signature_unique_idx` ON `agreement_signature` (`application_id`,`document`,`signer_kind`);--> statement-breakpoint
CREATE INDEX `agreement_signature_application_idx` ON `agreement_signature` (`application_id`);--> statement-breakpoint
CREATE TABLE `discord_link` (
	`user_id` text PRIMARY KEY NOT NULL,
	`discord_user_id` text NOT NULL,
	`discord_username` text,
	`linked_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	`joined_guild_at` integer,
	`last_sync_at` integer,
	`last_sync_error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_link_discord_idx` ON `discord_link` (`discord_user_id`);--> statement-breakpoint
CREATE TABLE `discord_role` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`role_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_role_kind_key_idx` ON `discord_role` (`kind`,`key`);--> statement-breakpoint
CREATE TABLE `guardian_contact` (
	`application_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`alt_phone` text,
	`updated_at` integer DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)) NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `application`(`id`) ON UPDATE no action ON DELETE cascade
);
