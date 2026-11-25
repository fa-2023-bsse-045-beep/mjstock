@echo off
setlocal
echo ========================================================
echo   MJ AUTOS - Generate Production Release Keystore
echo ========================================================
echo.

set KEYSTORE_PATH=android\app\release-keystore.jks
set ALIAS=mjautos
set STOREPASS=mjautos123
set KEYPASS=mjautos123
set DNAME="CN=MJ AUTOS, OU=IT, O=MJ AUTOS, L=Karachi, ST=Sindh, C=PK"

if exist "%KEYSTORE_PATH%" (
    echo Keystore already exists at %KEYSTORE_PATH%
    goto end
)

echo Creating keystore at %KEYSTORE_PATH% ...
keytool -genkeypair -v -keystore "%KEYSTORE_PATH%" -alias %ALIAS% -keyalg RSA -keysize 2048 -validity 10000 -storepass %STOREPASS% -keypass %KEYPASS% -dname %DNAME%

if %ERRORLEVEL% EQU 0 (
    echo.
    echo Keystore generated successfully at %KEYSTORE_PATH%!
    echo Keystore Password: %STOREPASS%
    echo Key Alias:         %ALIAS%
    echo Key Password:      %KEYPASS%
    echo.
    echo Keep this keystore safe! You need it to publish app updates on Google Play Store.
) else (
    echo.
    echo Failed to generate keystore. Ensure Java JDK keytool is in your PATH.
)

:end
endlocal
