// Reduced from MainDev/Script/Tests/1000_RuntimeTests/TestCase_10_OptionUI.as.
#if TEST
#if ASYNC_AWAIT
class UOptionUITestCase : UPLAutomationAsyncCaseBase_AS
{
    float GetOrder() const
    {
        return 10.f;
    }

    async FTask RunAsync(UPLAutomationAsyncContext T)
    {
        await TestSteps::WaitUntil(30.f, n"PredControllerReady", "wait player controller ready");
        T.SetConsoleVariable("log.LogPLAutomationTrace", 1);
        await UISteps::WaitForWidgetActive("WBP_Layout_Game_C_0", 90.f);
        T.Defer(n"CleanupUIFixture");
        this.BeginUIFixture();
        for (int i = 1; i <= 5; i += 1)
        {
            await UISteps::ClickChildAt("TopSettingsTabs", "TabButtonBox", i, 10.f);
            await TestSteps::WaitSeconds(0.3f);
        }
        UPLAutomationAction Action = UISteps::WaitForWidgetActive("Content_Map", 15.f);
        await Action;
        await ChildAsync();
    }

    async FTask ChildAsync()
    {
        await TestSteps::WaitSeconds(0.3f);
        return;
    }

    void BeginUIFixture() {}
    void Ordinary()
    {
        int async = 1;
        int await = 2;
        async += await;
        await++;
        this.BeginUIFixture();
    }
}
#endif
#endif
