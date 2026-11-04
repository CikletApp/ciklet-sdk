using UnrealBuildTool;

public class CikletSocial : ModuleRules
{
	public CikletSocial(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		CppStandard = CppStandardVersion.Cpp17;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"HTTP",
			"Json",
			"WebSockets",
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"CoreUObject",
			"Sockets",
			"Networking",
		});
	}
}
