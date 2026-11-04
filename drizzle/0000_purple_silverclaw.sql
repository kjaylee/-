CREATE TABLE `matches` (
	`code` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `matches_expires_at_idx` ON `matches` (`expires_at`);