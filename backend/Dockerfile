# 3D 配件檢視器 API（ASP.NET Core 8）
# 建置：docker build -t teslaselector-api backend
# 執行：docker run -p 8080:8080 -e ConnectionStrings__Viewer="Host=…;…" teslaselector-api

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
# 先只複製 csproj 還原套件，原始碼變動時可沿用這一層快取
COPY src/AccessoryViewer.Api/AccessoryViewer.Api.csproj src/AccessoryViewer.Api/
RUN dotnet restore src/AccessoryViewer.Api/AccessoryViewer.Api.csproj
COPY src/ src/
RUN dotnet publish src/AccessoryViewer.Api/AccessoryViewer.Api.csproj \
    -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
COPY --from=build /app/publish .
# 以映像檔內建的非 root 使用者執行
USER $APP_UID
ENTRYPOINT ["dotnet", "AccessoryViewer.Api.dll"]
