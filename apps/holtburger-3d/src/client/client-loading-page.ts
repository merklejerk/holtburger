/** Asset-independent pregame presentation; lifecycle owners supply actions separately. */
export type ClientLoadingPageState =
	| {
			readonly kind: "pending";
			/** Frontend-owned activity distinguishes asset startup, session loading, character return, and shutdown. */
			readonly activity:
				"assets" | "connection" | "scene" | "disconnect" | "return";
			readonly title: string;
			readonly message: string;
	  }
	| {
			/** Completed session outcome; never animates as pending work. */
			readonly kind: "ended";
			readonly failed: boolean;
			readonly title: string;
			readonly message: string;
			/** Full failure context, absent for an intentional disconnect. */
			readonly details: string | null;
	  }
	| {
			readonly kind: "failed";
			readonly title: string;
			readonly message: string;
			/** Original error retained for diagnosis without replacing the explanation. */
			readonly details: string;
	  };
